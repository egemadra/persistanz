"use strict";
var co=require("co");
var pc=require("./common.js").pc;
var DslResolver=require("./DslResolver.js");
var p=new WeakMap(); //private properties.

function _(q)
{
  return p.get(q);
}

/**
* The class that provides the query interface.
*
* **Do not create instances directly, instead use [Persistanz.query()](#Persistanz#query) method
* or Model.query() static method.**
* @class
*/
function PersQuery(opts)
{
  var privateProps={
    options: opts,
    baseTable: null,
    errors: [],
    dsl: { //these are put by the user in the respective clauses.
      from:null, where:null, limit:null, orderBy:null, groupBy:null, having:null,
      selects:[], withSelects:[], aliasSelects:[], distinct:false,
      calcLimitless:false, queryOptions:[], toManyWhere:null,
      whereValues:[], //entered by user to replace ?.
    },
    //tomany related props:
    parentQuery:null,
    toManyQueries:null, //a Map where keys are "parent query alias clean"."toManyExp.name", values are the qs.
    toManyExp:null,
    toManyProp:null,

    groupedRows:null, //only child queries have it. this is a map of grouped rows
    sqlClauses:{ //these are the resulting sqls.
      limitlessQuery: null, query: null, from:null, whereValues:[]
    },
    pers:opts.pers,
    modelDefs:opts.modelDefs,
    modelDefsByTableName:opts.modelDefsByTableName,
    adapter:opts.tx || opts.pers.adapter,
    inTransaction: !!opts.tx, //used in adapters to decide weather to destroy acquired connections in eventedQueries.
    //key is discriminator column like (_type), value is submodel name.
    discriminator:{},
    queryAlreadyBuilt:false,
    joins:{}, aliasMap:{}, aliasCount:0, mapInfo:{},
    requiredPkFields:{}, //customer.id=true kind of expressions for bridged fields to be added.
    //otherwise if user doesn't select customer.id but customer.name, the .customer field is
    //null even when query returns columns. This is because we have no other way of knowing
    //if the join brought null or values. ="auto" means we added. "user" means user added.
    //if auto, we must remove it from the resultset to respect the user. Created in resolveFields
    //and used in mapping.,
    indexField: null,
    indexAlias:null, //{alias: #1, field: x}
    events:{}, //keys are eventNames, values are arrays of function that are listeners.
  }

  p.set(this, privateProps);
}

function getRootQuery(aQuery)
{
  if (!_(aQuery).parentQuery) return aQuery;
  return getRootQuery(_(aQuery).parentQuery);
}

function groupRows(q, mappedRows)
{
  var groupedRows=new Map();
  var foreignKey=p.get(q).toManyProp.fkName;

  //TODO: indexed (Map) version is inefficient because we are creating
  //Maps TWICE for each row. During _mapRows() they are mapped, but here we Map them
  //again. This is because our q.aliasMap structure looks like #1.id, so by the
  //time we get here, we have already lost this information due to mapping has
  //already been performed. Ideal situation is to create a map only here (and)
  //not in _mapRows, but we need to find a a way to work with index fields
  //directy on the objects.
  if (mappedRows instanceof Map)
    mappedRows.forEach(function(object, key) {
      if (!groupedRows.has(object[foreignKey]))
        groupedRows.set(object[foreignKey], new Map());
      groupedRows.get(object[foreignKey]).set(key, object);
    });
  else
    mappedRows.forEach(function(object){
      if (!groupedRows.has(object[foreignKey]))
        groupedRows.set(object[foreignKey],[]);
      groupedRows.get(object[foreignKey]).push(object);
    });

  return groupedRows;
}

/**
* Makes the query so that results are indexed by one of the fields/columns of
* the model/table.
*
* If you called this method, the return value from .exec() is
* not an array anymore, but a javascript Map instance, where keys are indexes
* and values are objects. So .index("id") will return a Map of rows where keys
* are ids.
*
* See [index field usage](#indexed-result-set) discussion in the guide.
*
* @param {string} indexField A field conformant to the [fieldList](#PersQuery#select) expression.
* @return {persistanz.PersQuery} The query object itself.
*/
PersQuery.prototype.index=function(indexField)
{
  p.get(this).indexField=indexField;
  return this;
}

/**
* For short: **.f**
*
* Sets the from clause of the query.
* @chainable
* @param {string} from The name of the model you want to query.
* @return {persistanz.PersQuery} The query object itself.
*/
PersQuery.prototype.from=function(from)
{
  if (p.get(this).baseTable)
  {
    p.get(this).errors.push("From table is already set.");
    return;
  }

  var modelDef=p.get(this).modelDefs[from];
  if (modelDef==null)
  {
    p.get(this).errors.push("No model named '" + from + "' registered. (Used in from()).'");
    return this;
  }

  p.get(this).baseTable=p.get(this).pers.orm.classes[modelDef.table];
  var aliasObject=this._createAlias("", p.get(this).baseTable.name);
  p.get(this).mapInfo[aliasObject.clean]={className:aliasObject.table, modelName:modelDef.model.prototype.constructor.name};
  p.get(this).sqlClauses.from=p.get(this).pers.escapeId(p.get(this).baseTable.name) + " " + aliasObject.alias;

  //ok, but the base model can be a "single table inheritence" subclass,
  //so we also set the discrimitor here if exists:
  if (modelDef.discriminator!=null)
    p.get(this).discriminator[modelDef.discriminator]=from;
  return this;
}

PersQuery.prototype.f=PersQuery.prototype.from;

/**
* Adds a DISTINCT after the "SELECT" keyword. For SELECT DISTINCT queries.
* @chainable
* @return {persistanz.PersQuery} The query object itself.
*/
PersQuery.prototype.distinct=function()
{
  p.get(this).dsl.distinct=true;
  return this;
}

/**
* For short: **.s**
*
* Adds to the query's SELECT clause.
*
* Fields are separated by commas. Whitespace between them doesn't matter. A field can be one of the following:
*
* * A real column name in the table,
* * \*: to select all columns just as in normal SQL.
* * dot separated bridge field names with final part being either a real column name or \*. For example "customer.name", "product.brand.\*".
* * dot separated toMany field names. For example: "customer.orders.\*".
* * A negation expression starting with the ! character. This is to negate the expression, meaning that the columns
* generated by the expression are not to be present in the select clause (hence not in the returned objects).
* This is useful for example when you need to select all columns of the "User" (with \*) except the
* "password" field. In this case, your fieldList can be written as "\*, !password", instead of
* laboriously listing all the other columns. Works on bridge field names too, for example:
* "customer.\*, !customer.password, !customer.passwordResetToken".
*
* Select clause must exist in a select sql query, so if .select() is not called or fieldList is passed a _null_, persistanz treats it '\*'.
*
* This method can be called more than once, each time adding more fields to select.
* @chainable
* @param [fieldList="*"] {string} Read the description above.
* @return {persistanz.PersQuery} The query object itself.
*/
PersQuery.prototype.select=function(fieldList)
{
  if (fieldList==="" || fieldList==undefined) return this;
  p.get(this).dsl.selects.push(fieldList);
  return this;
}

PersQuery.prototype.s=PersQuery.prototype.select;

/**
* For short: **.sw**
*
* Adds to the query's SELECT clause.
*
* Sometimes selecting individual columns from a bridge field or toMany field becomes too verbose
* and require too much typing because of repeated bridges. Using this method, you can shorten it
* by setting a bridge field or toMany expression once and writing their fields separately.
*
* This is essentially a macro which expands to regular .select fields.
*
* ! and .\* are usable in the fieldList. See [PersQuery.select](#PersQuery#select).
*
* This method can be called more than once, each time adding more fields to select.
* @example
* //Instead of
* pers.q().f("OrderItem")
*   .s("product.category.title, product.category.parentCategoryId, product.category.isOnSale");
* //You can
* pers.q().f("OrderItem")
*  .selectWith("product.category", "title, parentCategoryId, isOnSale");
* @chainable
* @param {string} withPart An expression resolving to bridge field or a toMany field.
* @param {string} fieldList A field list expression. See [PersQuery.select](#PersQuery#select).
* @return {persistanz.PersQuery} The query object itself.
*/
PersQuery.prototype.selectWith=function(withPart, fieldList)
{
  p.get(this).dsl.withSelects.push({withPart, fieldList});
  return this;
}

PersQuery.prototype.sw=PersQuery.prototype.selectWith;

/**
* For short **.sa**
*
* Adds to the SELECT clause of the query, but uses [curlyExpression](#quot-curly-expression-quot) syntax.
* This is useful when you need to add things to select clause other than regular fields.
*
* This method can be called more than once, each time adding more fields to select.
* @chainable
* @example
* pers.q().sa("1+1, MAX({id}) as maxID");
* @param {string} selectExpression An expression to add to select clause in [curlyExpression](#quot-curly-expression-quot) syntax.
* @return {persistanz.PersQuery} The query object itself.
*/
PersQuery.prototype.selectAlias=function(selectExpression)
{
  p.get(this).dsl.aliasSelects.push(selectExpression);
  return this;
}

PersQuery.prototype.sa=PersQuery.prototype.selectAlias;

/**
* For short: **.w**
*
* Sets the WHERE clause of the query.
*
* If your where clause (whereClause param) does not contain question marks, you may omit the values argument.
* values can be a single value, or an array of values. Either case they are properly escaped
* by the underlying database binding before
* replacing question mark placeHolders in the _whereClause_.
* @chainable
* @example
* pers.q().where("{sentence}=?", "Hello world.");
* pers.q().where("{sentence}=? and {id}>?", ["Hello world.", 99]);
* //There is no way to escape the curly braces
* //in the curlyExpression argument, so having a where clause like
* //{sentence}='{hahaha}' confuses the query builder,
* //in such cases simply use
* pers.q().w("{sentence}=?",'{hahaha}');
* @param {string} whereClause An expression to set the where clause of the query in [curlyExpression](#quot-curly-expression-quot) syntax.
* @param [values=null] {Array|string|numeric} List of values to replace the question mark placeHolders in the whereClause.
* @return {persistanz.PersQuery} The query object itself.
*/
PersQuery.prototype.where=function(whereClause, values)
{
  p.get(this).dsl.where=whereClause;
  if (values!==undefined)
  {
    if (!(values instanceof Array))
      p.get(this).dsl.whereValues.push(values);
    else
      p.get(this).dsl.whereValues=values;
  }
  return this;
}

PersQuery.prototype.w=PersQuery.prototype.where;

/**
* For short: **.h**
*
* Sets HAVING clause of the query.
* @example pers.q().h("COUNT({order.customerId}) > 5740");
* @param {string} having having clause in [curlyExpression](#quot-curly-expression-quot) syntax.
* @return {persistanz.PersQuery} The query object itself.
*/
PersQuery.prototype.having=function(having)
{
  p.get(this).dsl.having=having;
  return this;
}

PersQuery.prototype.h=PersQuery.prototype.having;

/**
* For short: **.o**
*
* Sets ORDER BY clause of the query.
* @example
* pers.q().f('Booking').order("{customer.name} desc");
* @param {string} orderBy order by clause in [curlyExpression](#quot-curly-expression-quot) syntax.
* @return {persistanz.PersQuery} The query object itself.
*/
PersQuery.prototype.order=function(orderBy)
{
  p.get(this).dsl.orderBy=orderBy;
  return this;
}

PersQuery.prototype.o=PersQuery.prototype.order;

/**
* For short: **.l** (lowercase L)
*
* Sets LIMIT clause of the query.
*
* limitExpression is unprocessed by the query builder
* and passed verbatim to the SQL as the limit clause.
* @example
* pers.q().f('Customer').limit(10).exec();
* @param {string|numeric} limitExpression limit clause of the query.
* @return {persistanz.PersQuery} The query object itself.
*/
PersQuery.prototype.limit=function(limitExpression)
{
  p.get(this).dsl.limit=limitExpression;
  return this;
}

PersQuery.prototype.l=PersQuery.prototype.limit;

/**
* For short: **.g**
*
* Sets GROUP BY clause of the query.
* @example
* pers.q().f('Customer').group("{lastName}");
* @param {string} groupBy group by clause in [curlyExpression](#quot-curly-expression-quot) syntax.
* @return {persistanz.PersQuery} The query object itself.
*/
PersQuery.prototype.group=function(groupBy)
{
  p.get(this).dsl.groupBy=groupBy;
  return this;
}

PersQuery.prototype.g=PersQuery.prototype.group;

/**
* Requests the query builder to calculate how many rows would have returned
* if the query hadn't contained a LIMIT clause. Query builder then creates
* behind the scenes a second query to find out the number.
*
* Note that this changes the structure of the result returned by the .exec method.
* Instead of array of objects, return value is an object with 2 properties:
*
* - **count**: total row count without the limit clause
*
* - **objects**: actual objects (if not an evented query) array of the original query
*
* ###### &nbsp;
* @example
* pers.q().f("User").l(4).calc().exec().then(function(result){
*   console.log(result.objects); //Array of User objects
*   console.log(result.count); //a number
* });
*
* @return {persistanz.PersQuery} The query object itself.
*/
PersQuery.prototype.calc=function()
{
  p.get(this).dsl.calcLimitless=true;
  return this;
}

/**
* Adds all args, space separated, after the "SELECT" keyword without any changes.
*
* This is to handle engine specific query options like CALC_FOUND_ROWS, SQL_NO_CACHE etc.
* @example
* pers.q().options("SQL_NO_CACHE").f("Customer").exec();
* @param {string} options Options to pass to the query.
* @return {persistanz.PersQuery} The query object itself.
*/
PersQuery.prototype.options=function(options)
{
  p.get(this).dsl.queryOptions=[].slice.call(arguments).join(' ');
  return this;
}

PersQuery.prototype._toMany=function(toManyProp, mountPoint)
{
  //mountpoint is like #1.orders. Denotes the how to attach on the parent resultset.
  if (!p.get(this).toManyQueries) p.get(this).toManyQueries=new Map();
  if (p.get(this).toManyQueries.has(mountPoint))
    return p.get(this).toManyQueries.get(mountPoint);

  var q=new PersQuery(p.get(this).options);
  q.s(toManyProp.fkName); //productId. this must be added for mapping.
  q.from(toManyProp.toManyClass);
  p.get(q).parentQuery=this;
  p.get(q).toManyExp=toManyProp.name;
  p.get(q).toManyProp=toManyProp;
  var root=getRootQuery(q);
  q.exec=root.exec.bind(root); //use the parent's exec.
  p.get(this).toManyQueries.set(mountPoint,q);
  return q;
}

function resolveToMany(q, exp)
{
  var parts=exp.split('.');
  var lastTable=_(q).baseTable;
  var prefixes=[];
  var childQ=null;
  var pers=_(q).pers;
  var lastItemIsAQuery=false; //must end with a toMany field.

  for (var part of parts)
  {
    var prop=lastTable.props[part];
    var baseTableAlias=_(q).aliasMap[prefixes.join('.')];

    if (!prop)
    {
      _(getRootQuery(q)).errors.push("Can't resolve field '" + part + "' in the table '" + lastTable.name + "'. (In one of toManys)");
      return false;
    }

    if (!prop.oneToOneClass && !prop.toManyClass)
    {
      var e="'" + part + "' in the table '" + lastTable.name + "' resolves to a simple field. No simple fields allowed in one of toManys.";
      _(getRootQuery(q)).errors.push(e);
      return false;
    }

    if (prop.toManyClass)
    {
      var mountPoint=baseTableAlias.clean+"."+prop.name;
      childQ=q._toMany(prop, mountPoint);
      //id of the parent column is required so that we can have "where foreignKey in (ids)".
      var prefixesString=prefixes.join('.');
      if (prefixesString!=="") prefixesString+=".";
      var aReqField=prefixesString+lastTable.pkName;
      if (!_(q).requiredPkFields[aReqField])
        _(q).requiredPkFields[aReqField]={alias: baseTableAlias.clean, addedBy: "auto", field: aReqField};
      //now reset it to the base of the child query:
      lastTable=_(childQ).baseTable;
      q=childQ;
      prefixes=[];
      lastItemIsAQuery=true;
      continue;
    }
    else if (prop.oneToOneClass)
    {
      prefixes.push(prop.name);
      var prefixesString=prefixes.join('.');

      var a=q._createAlias(prefixesString, pers.orm.classes[prop.oneToOneClass].name);
      lastTable=pers.orm.classes[prop.oneToOneClass];

      _(q).mapInfo[a.clean]={
        propName:prop.name,
        className:lastTable.name,
        bindToAlias: baseTableAlias.clean,
        modelName: _(q).modelDefsByTableName[lastTable.name].model.prototype.constructor.name
      };

      //finally this must be in the select clause of the parent query so that
      //query builder can add the JOIN.
      //TODO: this is the reason why parent id field is always present in the
      //mapped result. we need something like requiredPkFields but one that
      //takes the whole expression into consideration, not only the id.
      if (prefixesString!=="") prefixesString+=".";
      var aReqField=prefixesString+lastTable.pkName;
      q.select(aReqField);
      lastItemIsAQuery=false;
    }
  }

  if (!lastItemIsAQuery)
  {
    _(getRootQuery(q)).errors.push("'" + exp + "' does not resolve to a toMany field. "+
      "Last item in a toMany expression must be a toMany field but '" + part + "' is not.");
    return false;
  }

  return childQ;
}

/**
* Creates a new toMany query on the parent query.
*
* See [toMany method guide](#tomany-method)
* @param {string} toManyExp Only one field from a [fieldList](#field-list) expression where the part after the last dot being a [toMany field](#tomany-field).
* @return {persistanz.PersQuery} A toMany query.
*/
PersQuery.prototype.toMany=function(toManyExp)
{
  var root=getRootQuery(this);
  var childQ=resolveToMany(root, toManyExp);
  if (!childQ)
    throw new Error(_(root).errors.join("\n"));
  return childQ;
}

/**
* Registers an event callback to the query and renders it a "streaming query".
*
*Following event types are defined and can be registered by calling this method multiple times, as many times for each:
*
*   **"object"**: Callback is called with an object (a row) is read from the database. Callback has (object, index) signature. object is the mapped object (a model instance), index is index value of the row if you called .index() method before exec.
*
*   **"end"**: Callback is called when all the rows are fetched. Nothing is passed to the callback arguments.
*
*   **"error"**: Callback is called when an error occurs in the query. Callback has (err) signature where err is the error object.
*
*   **"calc"**: Callback is called if you called .calc() before. Has (count) signature where count is filled with the number representing the number of rows that would have come if the query had no limit clause.
*
* Some database drivers accept other events too, if you define them, they are also called.
*
* This method modifies the .exec() result. The difference is that you can't obtain the results from .exec() anymore, you get them via "object" event callback.
*
* Please see [streaming queries](#streaming-queries) guide.
*
* @param {string} eventName One of the "object", "end", "error", "calc" or a database specific event name.
* @param {function} callback Callback function with various signatures. See the description above.
* @return {persistanz.PersQuery} The query object itself.
*/
PersQuery.prototype.on=function(eventName, cb)
{
  var events=p.get(this).events;
  if (!events[eventName]) events[eventName]=[];
  var me=this;

  //we intercept "object" event so that we can map:
  if (eventName==="object")
    events["object"].push(function(row){
      var mapped=me._mapRow(row, null, getRemovedFields(me));
      cb(mapped.object, mapped.index);
    });
  else
    events[eventName].push(cb);
  return this;
}

/**
* Executes a query and maps the resulting rows to objects.
*
* Return value (either as the second the parameter to callback or the return promise)
* is one of the following, depending on what methods called before the exec:
*
* - if none of the following methods called before, return value is an Array of objects: .index(), .calc(), .on().
*
* - if .index() is called, return value is a Map object where each key is the value of the field you passed to the index method, and each value
* is an object associated with that key.
*
* - if .calc() is called, return value is an object with two properties: .objects and .count. .count gives the total number of rows without the LIMIT clause,
* and .objects contain the returning objects either as a Map if .index() called, or a regular Array.
*
* - if .on() is called, return value does not contain objects, objects are passed to "object" event callback instead.
* If .calc() is called it still has the {objects,count} form and .count still gives the total
* number of rows without the LIMIT clause, but value of .objects field is meaningless and is set to _true_. If .calc() is not called, return value
* is _true_. If .index() is also called, index of each object is passed to the second argument to "calc" event callback.
*
* ######
*
* @example
* var ret=function (err, result){};
* //result is an Array object Customer objects:
* pers.q().f("Customer").exec(ret);
* //result is a Map object where keys are ids of Customers and
* //values are the objects with that id:
* pers.q().f("Customer").index("id").exec(ret);
* //result is an object with .count and .objects fields. .objects is an
* //Array and can contain maximum of 3 items. Total items without limit
* //is read from result.count:
* pers.q().f("Customer").limit(3).calc().exec(ret);
* //result is true, objects are passed to the "object" event callback:
* pers.q().f("Customer").on("object", function(anObject){}).exec(ret);
* //result in {count,objects} form. .objects is a Map:
* pers.q().f("Customer").limit(3).calc().index("id").exec(ret);
* //result in {count,objects} form. .objects reads true, count value can
* //be read both from calc event callback or as result.count.
* pers.q().f("Customer")
*   .on("object", function(anObject, index){
*      console.log(index, anObject);
*    })
*   .on("calc", function(totalRows){console.log(totalRows);})
*   .exec(ret);
* //Like the rest of this library, as an async method, .exec() can
* //return promises. So results can be obtained as a promise
* //if callback is omitted:
* var resultPromise=pers.q().f("Customer").limit(3).calc().exec();
* resultPromise.then(function(result){
*   //result is identical to "result" param of the "ret" function.
* });
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} Returns a promise which resolves to different things according to what methods called on the query object before .exec().
*/
PersQuery.prototype.exec=function(cb)
{
  var me=this;
  var fn=co.wrap(function*()
  {
    me.build();

    var hasChildQueries=p.get(me).toManyQueries && p.get(me).toManyQueries.size;

    if (Object.keys(p.get(me).events).length) //evented:
    {
      if (hasChildQueries) throw new Error("Streaming queries may not have toMany fields.");
      var queryPromise=yield p.get(me).adapter.eventedQuery(p.get(me).events, me.getQuery(), p.get(me).sqlClauses.whereValues, p.get(me).inTransaction);

      if (p.get(me).dsl.calcLimitless)
      {
        var countPromise=yield getCountedRows(me).then(function(countResult){
          if (p.get(me).events.calc)
            for (var e of p.get(me).events.calc)
              e(countResult);
          return countResult;
        });

        return {objects: queryPromise, count: countPromise};
      }
      else
        return queryPromise;
    }

    var rows=yield p.get(me).adapter.query(me.getQuery(), p.get(me).sqlClauses.whereValues);

    //if child queries exists, lets collect the ids and process them before mapping.
    if (hasChildQueries && rows.length)
    {
      for (var childQDef of p.get(me).toManyQueries)
      {
        var mountPoint=childQDef[0];
        var childQ=childQDef[1];
        var parts=mountPoint.split('.');
        var alias=parts[0];
        var mountObjectPkName= p.get(me).pers.orm.classes[p.get(me).mapInfo[alias].className].pkName;

        var ids=new Set();
        for (var aRow in rows)
        {
          var columnName=alias+"."+mountObjectPkName;
          ids.add(p.get(me).pers.escape(rows[aRow][columnName]));
        }
        var idsString=Array.from(ids).join(', ');

        var escapeId=p.get(me).pers.escapeId.bind(p.get(me).pers);
        var columnEscapedAlias=escapeId("#0")+"."+escapeId(p.get(childQ).toManyProp.fkName);
        p.get(childQ).dsl.toManyWhere=columnEscapedAlias + " IN (" + idsString + ")";
        childQ.exec=getRootQuery(childQ).exec.bind(childQ);
        yield childQ.exec();
      }
    }

    var mappedRows=me._mapRows(rows, getRemovedFields(me));

    //if parent query exists, lets group our results:
    //move this to mapping for optimization.
    if (p.get(me).parentQuery)
    {
      var groupedRows=groupRows(me, mappedRows);
      p.get(me).groupedRows=groupedRows;
      return groupedRows;
    }

    return !p.get(me).dsl.calcLimitless
      ? mappedRows
      : {objects: mappedRows, count: yield getCountedRows(me)};
  });

  if (!cb) return fn();
  fn().then(function(val){
    cb.call(me, null, val);
  },function(err){
    cb.call(me, err, null);
  });
}

/**
* Builds the SQL query.
*
* Explicitly calling this method is normally not necessary, as .exec method
* automatically calls it. However, if you are interested only in the generated
* SQL and not the results, you can get it without executing the query.
* @example
* var sql=pers.q().f("Customer").s("name").w("{id}=4").build().getQuery();
* console.log(sql); //logs the generated SQL query.
* @return {persistanz.PersQuery} The query object itself.
*/
PersQuery.prototype.build=function ()
{
  var me=this;
  if (p.get(this).queryAlreadyBuilt) return this;
  if (p.get(this).errors.length) throw new Error(p.get(this).errors.join("\n"));
  this._expandSelectWithToSelects();
  var s=this._processSelect(); //also handles index
  var as= p.get(this).dsl.aliasSelects.map(function(as){
    return me._processCurlyExpression("aliasSelect", as);
  }).join(', ');
  var w=this._processWhere();
  var d=this._processDiscriminators();
  var l=p.get(this).dsl.limit==undefined ? null : p.get(this).dsl.limit;
  this._processCurlyExpression("orderBy", p.get(this).dsl.orderBy);
  var o=p.get(this).dsl.orderBy==undefined ? null : this._processCurlyExpression("orderBy", p.get(this).dsl.orderBy);
  var g=p.get(this).dsl.groupBy==undefined ? null : this._processCurlyExpression("groupBy", p.get(this).dsl.groupBy);
  var h=p.get(this).dsl.having==undefined ? null : this._processCurlyExpression("having", p.get(this).dsl.having);

  if (p.get(this).errors.length) throw new Error(p.get(me).errors.join("\n"));
  //joins:
  var joinStrs=[];
  Object.keys(p.get(me).joins).forEach(function(key) {
    var a=p.get(me).aliasMap[ key ].alias;
    var j=p.get(me).joins[key];
    var joinPk=p.get(me).pers.escapeId(p.get(me).pers.orm.classes[j.prop.oneToOneClass].pkName);
    var boundFk=p.get(me).pers.escapeId(j.prop.boundFk);
    joinStrs.push("LEFT JOIN " + p.get(me).pers.escapeId(j.prop.oneToOneClass) + " " + a  + " ON " + a + "." + joinPk +  " = " + j.baseTableAlias.alias + "." + boundFk);
  });
  var joinSql=joinStrs.join("\n");

  var inSelects=[];
  if (s!=='') inSelects.push(s);
  if (as!=='') inSelects.push(as);

  var onlySelectQ="", mainQ="SELECT ";

  if (p.get(this).dsl.queryOptions!=null) mainQ+=p.get(this).dsl.queryOptions+" ";
  if (p.get(this).dsl.distinct) mainQ+="DISTINCT ";
  mainQ+= inSelects.join(", ");

  var q="\nFROM " + p.get(this).sqlClauses.from;
  if (joinSql!=="") q+="\n" + joinSql;

  //where part is complicated becase we have 3 sources:
  //user called .where, descriminator where and toManyQuery in ids.
  var whereBlocks=[];
  if (w!=undefined) whereBlocks.push(w);
  if (d!=undefined)
  {
    //add discriminator if exists:
    if (Object.keys(p.get(me).discriminator).length)
      p.get(me).sqlClauses.whereValues.push(p.get(me).discriminator[Object.keys(p.get(me).discriminator)[0]]);
    whereBlocks.push(d + "=?");
  }
  if (p.get(this).dsl.toManyWhere!=undefined)
    whereBlocks.push(p.get(this).dsl.toManyWhere);

  if (whereBlocks.length)
  {
    if (w!=undefined) //because it may have ORs in it.
      whereBlocks[0]="( " + whereBlocks[0] + ")"
    q+="\nWHERE "+whereBlocks.join(" AND ");
  }

  if (g!=undefined) q+="\nGROUP BY " + g;
  if (h!=undefined) q+="\nHAVING " + h; //TODO: placeHolders!!!
  if (o!=undefined) onlySelectQ+="\nORDER BY " + o;
  if (l!=undefined) onlySelectQ+="\nLIMIT " + l;

  p.get(this).sqlClauses.query=mainQ + q + onlySelectQ;
  /*
  if (p.get(this).dsl.calcLimitless) p.get(this).sqlClauses.limitlessQuery="SELECT COUNT(*) AS " +
    p.get(me).pers.escapeId("count") + q;
    */
  if (p.get(this).dsl.calcLimitless)
  {
    p.get(this).sqlClauses.limitlessQuery="SELECT COUNT(*) AS " +
    p.get(me).pers.escapeId("count") + "\nFROM (\n" +
    mainQ + q + "\n) " + p.get(me).pers.escapeId("#SOME_TABLE_REQUIRED BY SOME_DATABASES");
  }

  p.get(this).queryAlreadyBuilt=true;
  return this;
}

PersQuery.prototype.getQuery=function()
{
  return p.get(this).sqlClauses.query;
}

PersQuery.prototype.getQueryValues=function()
{
  return p.get(this).sqlClauses.whereValues;
}

/****************************************************************************/

function getCountedRows(q)
{
  return p.get(q).adapter.query(p.get(q).sqlClauses.limitlessQuery, p.get(q).sqlClauses.whereValues)
    .then(function(r){
      return r.pop()["count"];
    });
}

function getRemovedFields(q)
{
  var removeFields={};
  for (var key in p.get(q).requiredPkFields)
    if (p.get(q).requiredPkFields[key].addedBy==="auto")
      removeFields[p.get(q).requiredPkFields[key].alias]=true;

  return removeFields;
}

PersQuery.prototype._mapRow=function(row, childMap, removeFields)
{
  var me=this;
  var objects={};
  var indexAlias=p.get(this).indexAlias;

  //create empty objects based on the map, keyed to aliases:
  for (var anAlias in p.get(me).mapInfo)
    objects[anAlias]=new (p.get(me).modelDefs[p.get(me).mapInfo[anAlias].modelName].model)();

  //extract columns:
  //TODO: This needs to be optimized. We are in the inner loop, so
  //try to avoid split, shift and join by analysing field mapping
  //before rows.forEach, and then only loop to assign properties.
  for (var aliasedColumn in row)
  {
    var parts=aliasedColumn.split('.');
    var aliasClean=parts.shift();
    var fieldPart=parts.join('.');

    if (objects[aliasClean])
      objects[aliasClean][fieldPart]=row[aliasedColumn];
    else //.selectAlias exps don't map, they are attached to object #0.
      objects["#0"][aliasedColumn]=row[aliasedColumn];
  }

  //bind objects to each other.
  for (var anAlias in p.get(me).mapInfo)
  {
    //while looping, add child columns
    if (childMap && childMap[anAlias] && objects[anAlias])
    {
      for (var toManyColumn in childMap[anAlias])
      {
        var childMapObject=childMap[anAlias][toManyColumn];
        var pkName=childMapObject.mountObjectPkName;
        //children are grouped in a Map, where keys are ids of parent rows.
        //if no child exits, Map returns undefined, but we set it to a proper array.
        objects[anAlias][toManyColumn]=p.get(childMapObject.q).groupedRows.get(objects[anAlias][pkName]) || [];
      }
    }

    //attach objects to each other:
    var oMap=p.get(me).mapInfo[anAlias];
    if (oMap.bindToAlias) //root object doesn't have it.
    {
      //we want bridgeFields to be null if the result brought a null id.
      var pkName=p.get(me).pers.orm.classes[oMap.className].pkName;
      objects[oMap.bindToAlias][oMap.propName]= objects[anAlias][pkName]!=null ? objects[anAlias] : null;
      //if the user didn't exclusively wanted the pk, remove it.
      //don't attempt to delete properties from the fields that are nulled above:
      if (removeFields[anAlias] && objects[oMap.bindToAlias][oMap.propName])
        delete objects[oMap.bindToAlias][oMap.propName][pkName];
    }
  }

  var index=indexAlias ? objects[indexAlias.alias][indexAlias.field] : null;

  //after load:
  co(function *(){
    for (var i in objects)
      if (typeof objects[i].afterLoad === 'function')
        objects[i].afterLoad.length===2
          ? yield pc(objects[i].afterLoad, objects[i], [_(me).options.tx])
          : yield objects[i].afterLoad(_(me).options.tx);
  });
  
  return {object: objects["#0"], index};
}

PersQuery.prototype._mapRows=function(rows, removeFields)
{
  var me=this;
  var indexField=p.get(this).indexField;
  var results=indexField==undefined ? [] : new Map();

  var childMap={ }
  if (p.get(this).toManyQueries)
  {
    for (var tmq of p.get(this).toManyQueries)
    {
      var mountPoint=tmq[0];
      var q=tmq[1];
      var parts=mountPoint.split('.');
      var alias=parts.shift();
      if (!childMap[alias]) childMap[alias]={};
      childMap[alias][parts.join('.')]={
        q:q,
        mountObjectPkName: p.get(me).pers.orm.classes[p.get(me).mapInfo[alias].className].pkName
      }
    }
  }

  rows.forEach(function(row){
    var mapped=me._mapRow(row, childMap, removeFields);
    if (indexField==undefined)
      results.push(mapped.object);
    else
      results.set(mapped.index, mapped.object);
  });

  return results;
}

PersQuery.prototype._createAlias=function(prefix, tableName)
{
  if (!p.get(this).aliasMap[prefix])
  {
    var a=p.get(this).aliasCount++;
    p.get(this).aliasMap[prefix]={alias: p.get(this).pers.escapeId("#" + a), clean: "#" + a, table: tableName}  ;
  }
  return p.get(this).aliasMap[prefix];
}

PersQuery.prototype._expandSelectWithToSelects=function()
{
  //collect all blocks, split by ',' and trim:
  var fieldList=p.get(this).dsl.withSelects.map(function(wrsObject){

    var withPart=wrsObject.withPart.trim();

    return wrsObject.fieldList.split(',').map(function(part){
      var trimmed=part.trim();
      if (trimmed.substr(0,1)==='!') //put the ! to the beginning as it is the regular syntax.
        return "!" + withPart + "." + trimmed.substring(1);
      else
        return withPart + "." + trimmed;
    });
  });

  p.get(this).dsl.selects=p.get(this).dsl.selects.concat([].concat.apply([], fieldList));
}

PersQuery.prototype._processCurlyExpression=function(forWhat, expression)
{
  if (expression==undefined) return;
  var resolver=new DslResolver(p.get(this).pers, this, p, p.get(this).modelDefsByTableName);
  return resolver.resolveCurlyExpression(forWhat, expression);
}

PersQuery.prototype._processSelect=function()
{
  //- simple fields directly connected to the table mentioned in the from: "name, age"
  //- *: "*",
  //- fields from connecting table "author.name, author.wife.age, author.*, author.specs.*"
  //- exclude fields: "!name, author.wife.*, !author.wife.age"
  //- alias: "name, parent.name as pname" (use .sa)
  //- to many: "author.pets.*, author.cars.*, !author.cars.year, author.pets.friends.*", [TODO. We don't have metadata.]
  //- select with .sw("author.wife","name,age,pet.*,!pet.vetName)"
  //- agr: (We cannot do that, add function as select like sa/sf("FLOOR(AVG({author.salary}))", msalary), (use .sa)

  //collect all select blocks, split by , and trim:
  //handle empty select and resolve it to "*".
  var me=this;

  if (!p.get(this).dsl.selects.length && !p.get(this).dsl.aliasSelects.length)
    p.get(this).dsl.selects.push("*");

  var fieldList=p.get(this).dsl.selects.map(function(select){
    return select.split(',').map(function(part){return part.trim() });
  });

  var indexList=p.get(this).indexField!=undefined ? this._resolveFields([p.get(this).indexField], 'index') : [];

  //merge the arrays:
  var merged = [].concat.apply([], fieldList, indexList);

  //unique:
  fieldList=merged.filter(function(elem, pos) {
    return merged.indexOf(elem) == pos;
  });

  var finalFields=this._resolveFields(fieldList, 'select');

  var selectParts=[];
  finalFields.forEach(function(f){
    var absParts=f.split('=>');
    var prefixPart=absParts[0];
    var parts=prefixPart.split('.');
    var lastPart= parts.pop();
    var aliasMapKey=parts.length ? parts.join('.') : '';
    var aliasLastPart=absParts.length>1 ? absParts.pop() : lastPart;
    var fieldAlias=p.get(me).pers.escapeId(p.get(me).aliasMap[aliasMapKey].clean + "." + aliasLastPart);
    selectParts.push(p.get(me).aliasMap[aliasMapKey].alias + "." + p.get(me).pers.escapeId(lastPart) + " AS " +  fieldAlias);
  });

  return selectParts.join(", ");
}

PersQuery.prototype._processWhere=function()
{
  if (p.get(this).dsl.where===undefined) return;
  var whereSql=this._processCurlyExpression("where", p.get(this).dsl.where);

  var resolvedParams=[];

  //http://stackoverflow.com/questions/10584748/find-and-replace-nth-occurrence-of-bracketed-expression-in-string
  function replacePlaceholder(str, index, replace)
  {
    var nth = 0;
    return str.replace(/\?/, function (match, i, original) {
        return (++nth === index) ? replace : match;
    });
  }

  for (var i in p.get(this).dsl.whereValues)
  {
    var value=p.get(this).dsl.whereValues[i];

    //we build the subquery and replace the question mark with it ourselves, so
    //that adapters don't escape it. We have to be careful with the ? order and
    //only replace the right ?. This changes "where" params array, so we create
    //a new one by pushing normal params that are to be escaped.
    if (value instanceof PersQuery)
    {
      var q=" (" + value.build().getQuery() + ") ";
      whereSql=replacePlaceholder(whereSql, parseInt(i)+1, q);
      value.getQueryValues().forEach(function(v){
        resolvedParams.push(v);
      });
    }
    else
      resolvedParams.push(value);
  }

  //TODO: check if unusable type;
  p.get(this).sqlClauses.whereValues=resolvedParams;
  return whereSql;
}

PersQuery.prototype._processDiscriminators=function()
{
  var discColumns=Object.keys(p.get(this).discriminator);
  if (!discColumns.length) return;
  return this._processCurlyExpression("discriminate", "{"+discColumns.pop()+"}");
}

//resolves name, user.*, !wife.age kind of expressions and generates
//necessary aliases as well as joins.
PersQuery.prototype._resolveFields=function(fieldList, forWhat)
{
  var resolver=new DslResolver(p.get(this).pers, this, p, p.get(this).modelDefsByTableName);
  var resolved=resolver.resolveFields(fieldList, forWhat);
  return resolved;
}

module.exports=PersQuery;
