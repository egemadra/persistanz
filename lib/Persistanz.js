"use strict";
var co=require("co");
var Transaction=require("./PersTransaction.js");
var Query=require("./PersQuery.js");
var common=require("./common.js");

//TODO:
//logger!
//change bridgeField model for submodels. IMPORTANT. also set/remove irrelevant fields.
//toMany extension (partially done)
//big queries with .on ... test it to see.
//non-foreign-keyed bridges! (difficult because of ondelete integritity checks,
   //null/not-null etc must be dealt within the library.
//field abstraction for save and update queries!

module.exports=Persistanz;

/**
* The main class of the library
* @class
* @constructor
* @param {object|string} dbConfig database config object or a connection string. See [Database configuration](#database-configuration).
* @param {object=} options Persistanz options. See [Persistanz configuration](#persistanz-configuration).
*/
function Persistanz(dbConfig, options)
{
  var defaultOptions={
    baseModel:null, //all internal objects extends this model
    extend: true, //user models extend internal models
    models:[],
    toMany: true,
  };

  //if dbConfig is an object, it must have adapter:"postgres" kind of
  //expression besides other connection parameters.
  this.dbConfig=dbConfig;

  this.options=options ? Object.assign(defaultOptions, options) : defaultOptions;
  this.orm=null;

  /**
  * An array of all models registered to persistanz.
  * Access your models as pers.model.ModelName
  * @type {Model[]}
  */
  this.models = {};

  /**
  * An alias to [Persistanz.models](#Persistanz#models)
  */
  this.m=this.models;

  this.abstractAffix=null; //{"type": "suffix/prefix", "affix":"_gb/gb_"};

  /**
  * Underlying PersAdapter instance.
  * Use this to perform row queryies.
  * @type {persistanz.PersAdapter}
  */
  this.adapter=null;

  var modelDefs={}, modelDefsByTableName={};
  var mainQuery, ormErrors=[]; //we cant throw on bridge prop errors because they can be fixed later.

  var pers=this;
  //******************** end of constructor **********************/

  /**
  * Creates and prepares the persistanz object.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} Returns a promise object resolving to true.
  */
  this.create=function(cb){
    var fn=co.wrap(function *() {

      //create adapter instance, connect and create internal schema data.
      var dbConfig=(typeof pers.dbConfig === "string")
        ? parseDbUrl(pers.dbConfig)
        : pers.dbConfig;

      if (["mysql", "postgres", "sqlite3"].indexOf(dbConfig.adapter)<0)
        throw new Error("Database adapter is not specified or not supported.");

      pers.adapter=new (require("./adapters/"+dbConfig.adapter+".js"))(dbConfig);
      var l=yield pers.adapter.connect();
      pers.orm=yield pers.adapter.createOrm(ormErrors);

      //create default and user models:
      if (!pers.options.models || pers.options.models.constructor !== Array)
        throw new Error("'models' property in the options must be an array.");
      createModels(pers.options.models, true);
      handleToManyConfiguration();
      checkOrmErrors();
      //seems ok:
      return Promise.resolve(true);
    });

    if (!cb) return fn();
    fn().then(function(val){
      return cb.call(pers, null, val);
    },function(err){
      return cb.call(pers, err, null);
    });
  }

  this.getQuery=function()
  {
    return mainQuery;
  }

  /**
  * Forces database connection pool to drain.
  * All open db connections are destroyed gracefully as soon as they become idle.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} Returns a promise.
  */
  this.destroy=function(cb)
  {
    var me=this;
    var fn=co.wrap(function*(){
      return yield me.adapter.close();
    });

    if (!cb) return fn();
    fn().then(function(val){
      cb.call(null, null, val);
    },function(err){
      cb.call(null, err, null);
    });
  }

  /**
  * Escapes the expression to be used in an SQL query and returns it.
  * @deprecated This is not safe and not used internally anymore.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {string} The escaped string.
  */
  this.escape=function(expression)
  {
    if (expression===undefined) return null;
    if (expression===null) return "NULL";
    return "'" + (""+expression).replace(/'/g, "''") + "'";
  }

  /**
  * Escapes and returns the expression which is a table or column name to be used in an SQL query.
  * @param {string} expression Expression to escape
  * @return {string} The escaped string
  */
  this.escapeId=function(expression)
  {
    switch(this.adapter.name)
    {
      case "mysql": return '`' + expression.replace(/`/g, '``') + '`';
      case "sqlite3":  return '"' + expression.replace(/"/g, '""') + '"';
      case "postgres": return '"' + expression.replace(/"/g, '""') + '"';
    }
  }

  /**
  * Returns a transation object. "BEGIN" query is executed automatically.
  * @param {object} transactionOptions Currently unused, pass null.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise.Transaction} Returns a promise resolving to a transaction object
  */
  this.getTransaction=function(transactionOptions, cb)
  {
    var me=this;
    var fn=co.wrap(function *() {
      let isolated=yield me.adapter.acquire();
      let tx=new Transaction(isolated, transactionOptions);
      var b=yield tx.begin();
      return tx;
    });

    if (!cb) return fn();
    fn().then(function(val){
      cb.call(object, null, val);
    },function(err){
      cb.call(object, err, null);
    });
  }

  this._cast=function(fromObject, toModelDef) //does not check, used from q().
  {
    var o=new toModelDef.model();
    return Object.assign(o, fromObject);
  }

  /**
  * Casts fromObject to a model whose name is toName.
  *
  * Objects are created with the new keyword, so the constructor is run.
  * Note that persistanz uses Object.assign, so unrelated columns that are
  * not in the class (if they exist in your object) are copied too.
  * This function is internally used and rarely needed in user code as
  * .saveAs and .insertAs methods automatically calls .cast, thus are less verbose.
  * @example pz.cast({name: "zubi"}, "Customer");
  * @param {object} fromObject Any javascript object to be typecasted to one of the models
  * @param {string} toName Name of of the model to cast the object to
  * @return {object} An object whose type name is toName
  */
  this.cast=function(fromObject, toName)
  {
    var modelDef=findModelDefFromName(toName);
    return this._cast(fromObject, modelDef);
  }

  /**
  * Prepares and returns a PersQuery instance.
  *
  * Has an alias: **q()**
  * @param [tx=null] {persistanz.PersTransaction} A Transaction instance.
  * @return {PersQuery} A PersQuery instance.
  */
  this.query=function(tx)
  {
    var me=this;
    var q=new Query({
      tx: tx,
      pers:me,
      modelDefs: modelDefs,
      modelDefsByTableName: modelDefsByTableName,
    });
    return q;
  }

  /**
  * An alias to [Persistanz.query()](#Persistanz#query)
  */
  this.q=this.query;

  /**
  * Queries the database and returns the object whose id and modelName is specified or null if no row found, in a transaction context.
  * @see [PersQuery.select](#PersQuery#select) on how to use the fieldList
  * @param {persistanz.PersTransaction} tx A transaction instance obtained by calling Persistanz.getTransaction().
  * @param {string|numeric} id Primary key
  * @param [fieldList='*'] {string} fields A comma separated field list to be added in the select clause.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the loaded object.
  */
  this.loadByIdX=function(tx, modelName, id, fields, cb)
  {
    if (!tx) return returnXError(cb);
    return loadById(tx, modelName, id, fields, cb);
  }

  /**
  * Queries the database and returns the object whose id and modelName is specified or null if no row found.
  * @see [PersQuery.select](#PersQuery#select) on how to use the fieldList
  * @param {string} modelName Load for this model
  * @param {string|numeric} id Primary key
  * @param [fieldList='*'] {string} fields A comma separated field list to be added in the select clause.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the loaded object.
  */
  this.loadById=function(modelName, id, fieldList, cb){
    return loadById(null, modelName, id, fieldList, cb);
  }

  function copyProperties(baseObject, newObject)
  {
    var modelDef=findModelDefFromObject(newObject);
    for (var fieldName in pers.orm.classes[modelDef.table].props)
    {
      if (newObject[fieldName]!=undefined)
      {
        var field=pers.orm.classes[modelDef.table].props[fieldName];
        if (!field.oneToOneClass) //primitive fields & toMany fields are fully overwritten.
          baseObject[fieldName]=newObject[fieldName];
        else //bridge field. We cherrypick from the new object and add only the new properties.
        {
          if (baseObject[fieldName]==undefined)
            baseObject[fieldName]=newObject[fieldName];
          else
            copyProperties(baseObject[fieldName], newObject[fieldName]);
        }
      }
    }
    return baseObject;
  }

  function hydrate(tx, object, fieldList, cb)
  {
    var fn=co.wrap(function*(){
      var modelDef=findModelDefFromObject(object);
      var modelName=modelDef.model.prototype.constructor.name;
      var pkName=pers.orm.classes[modelDef.table].pkName;
      var pkValue=object[pkName];
      if (pkValue==undefined) throw new Error("Can't hydrate without the primary key is set.");
      var newObject=yield loadById(tx, modelName, pkValue, fieldList);
      return copyProperties(object, newObject);
    });

    if (!cb) return fn();
    fn().then(function(val){
      return cb.call(pers, null, val);
    },function(err){
      return cb.call(pers, err, null);
    });
  }

  /**
  * Loads the properties of an object from the database in a transaction context according to the given field list.
  * The primary key of the object must already be set.
  * @param {persistanz.PersTransaction} tx A transaction object.
  * @param {object} object A model instance to be hydrated.
  * @param [fieldList='*'] {string} A comma separated field list to be added in the select clause.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the same object, but now hydrated.
  */
  this.hydrateX=function(tx, object, fieldList, cb)
  {
    if (!tx) return returnXError(cb);
    return hydrate(tx, object, fieldList, cb);
  }

  /**
  * Loads the properties of an object from the database according to the given field list.
  * The primary key of the object must already be set.
  * @example
  * var c=new Customer();
  * c.id=1;
  * pers.hydrate(c, "name", function(err, result){
  *   //c is now hydrated.
  *   console.log(c.name); //logs a name.
  *   console.log(c===result) //logs true.
  * });
  * @param {object} object A model instance to be hydrated.
  * @param [fieldList='*'] {string} A comma separated field list to be added in the select clause.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the same object, but now hydrated.
  */
  this.hydrate=function(object, fieldList, cb)
  {
    return hydrate(null, object, fieldList, cb);
  }

  /**
  * Same as [Persistanz.save](#Persistanz#save), except that it always tries to execute an INSERT.
  * In some cases this is needed if you want to insert an object with a
  * predefined primary key instead of relying on database auto-increment.
  * @see [Persistanz.save](#Persistanz#save)
  * @param {object} object An object already typecast to one of the models.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type.
  */
  this.insert=function(object, cb)
  {
    return save(null, object, true, cb);
  }

  /**
  * Tries to save the given object using and INSERT command, in a transaction context.
  * @see [Persistanz.save](#Persistanz#save) and [Persistanz.insert](#Persistanz#insert)
  * @param {persistanz.PersTransaction} tx A transaction instance obtained by calling Persistanz.getTransaction().
  * @param {object} object An instance of a model.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type.
  */
  this.insertX=function(tx, object, cb)
  {
    if (!tx) return returnXError(cb);
    return save(tx, object, true, cb);
  }

  /**
  * Tries to save the given object. If the primary key is set, attempts to do an UPDATE query,
  * if not, an INSERT query. After the call, the object's primary key is set if it was an insert operation.
  * Return value is an object (saveResult) with the following members:
  *
  * **object**: The object you passed in. After an INSERT query, the primary key is set.
  *
  * **status**: Can be "saved", "not-saved" or "cancelled".
  * If beforeSave hook is run and returned false, the value reads "cancelled".
  * If saving didn't change any rows this value reads "not-saved".
  * This happens if an update query was perfomred and there was no row with the primary key of the object.
  *
  * **command**: "insert" or "update", depending on whether the primary key was set before the save.
  *
  * **lastInsertId**: The id of the saved object or null if the command was update.
  *
  * @param {object} object An instance of a model.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type.
  */
  this.save=function(object, cb)
  {
    return save(null, object, false, cb);
  }

  /**
  * Tries to save the given object in a transaction context.
  * @see [Persistanz.save](#Persistanz#save)
  * @param {persistanz.PersTransaction} tx A transaction instance obtained by calling Persistanz.getTransaction().
  * @param {object} object An instance of a model.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type.
  */
  this.saveX=function(tx, object, cb)
  {
      if (!tx) return returnXError(cb);
    return save(tx, object, false, cb);
  }

  /**
  * Casts the given generic object to model whose name is modelName, then attempts to save it.
  * Saving process and return value is identical to Persistanz.save.
  *
  * @see [Persistanz.save](#Persistanz#save)
  * @param {object} object An object.
  * @param {string} modelName The passed object will be saved as if it is an instance of a model whose name is modelName.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type.
  */
  this.saveAs=function(object, modelName, cb)
  {
    return saveAs(null, object, modelName, false, cb);
  }

  /**
  * Casts the given generic object to model whose name is modelName, then attempts to save it within a transaction context.
  * This is essentially a Persistanz.saveAs within a transaction.
  *
  * @see [Persistanz.saveAs](#Persistanz#saveAs)
  * @param {persistanz.PersTransaction} tx A transaction instance obtained by calling Persistanz.getTransaction().
  * @param {object} object An object.
  * @param {string} modelName The passed object will be saved as if it is an instance of a model whose name is modelName.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type.
  */
  this.saveAsX=function(tx, object, modelName, cb)
  {
    if (!tx) return returnXError(cb);
    return saveAs(tx, object, modelName, false, cb);
  }

  /**
  * Casts the given generic object to model whose name is modelName, then attempts to perform an INSERT query.
  * Saving process and return value is identical to Persistanz.save.
  *
  * @see [Persistanz.save](#Persistanz#save), [Persistanz.saveAs](#Persistanz#saveAs) and [Persistanz.insert](#Persistanz#insert)
  * @param {object} object An object.
  * @param {string} modelName The passed object will be inserted as if it is an instance of a model whose name is modelName.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type.
  */
  this.insertAs=function(object, modelName, cb)
  {
    return saveAs(null, object, modelName, true, cb);
  }

  /**
  * Casts the given generic object to model whose name is modelName,
  * then attempts to perform an INSERT query in the context of a transaction.
  *
  * @see [Persistanz.save](#Persistanz#save), [Persistanz.saveAs](#Persistanz#saveAs) and [Persistanz.insert](#Persistanz#insert)
  * @param {persistanz.PersTransaction} tx A transaction instance obtained by calling Persistanz.getTransaction().
  * @param {object} object An object.
  * @param {string} modelName The passed object will be inserted as if it is an instance of a model whose name is modelName.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type.
  */
  this.insertAsX=function(tx, object, modelName, cb)
  {
    if (!tx) return returnXError(cb);
    return saveAs(tx, object, modelName, true, cb);
  }

  /**
  * Attempts to delete a row from the database whose primary key is given in id
  * and model name is given in modelName.
  * Returns a saveResult object but .command member reads "delete".
  * If beforeDelete hook is called and returned false, status member of the saveResult reads "cancelled".
  * If no rows are deleted, status member of the saveResult reads "not-deleted".
  * @param {persistanz.PersTransaction} tx A transaction instance obtained by calling Persistanz.getTransaction().
  * @param {string} modelName Name of the model from whose table the row will be deleted.
  * @param {string|numeric} id A primary key value.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type, with the .command field which reads "delete"
  */
  this.deleteById=function(modelName, id, cb)
  {
    return deleteById(null, modelName, id, cb);
  }

  /**
  * Attempts to delete a row from the database whose primary key is given in id
  * and model name is given in modelName in a transaction context.
  * @see [Persistanz.deleteById](#Persistanz#deleteById)
  * @param {persistanz.PersTransaction} tx A transaction instance obtained by calling Persistanz.getTransaction().
  * @param {string} modelName Name of the model from whose table the row will be deleted.
  * @param {string|numeric} id A primary key value.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type, with the command which reads "delete"
  */
  this.deleteByIdX=function(tx, modelName, id, cb)
  {
    if (!tx) return returnXError(cb);
    return deleteById(tx, modelName, id, cb);
  }

  /**
  * Tries to delete the passed object. If the object has no set primary key value, the method fails with an error.
  * @param {object} object An instance of a model.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type, with the .command field reads "delete"
  */
  this.deleteObject=function(object, cb){
    return deleteObject(null, object, cb);
  }

  /**
  * Tries to delete the passed object in the context of a transaction.
  * If the object has no set primary key value, the method fails with an error.
  * @see [Persistanz.deleteObject](#Persistanz#deleteObject)
  * @param {persistanz.PersTransaction} tx A transaction instance obtained by calling Persistanz.getTransaction().
  * @param {object} object An instance of a model.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type, with the .command field reads "delete"
  */
  this.deleteObjectX=function(tx, object, cb){
    if (!tx) return returnXError(cb);
    return deleteObject(tx, object, cb);
  }

  /**
  * When persistanz can't find a
  * column listed in clauses it attempts to add the affix to the given field name and
  * sees if the new version matches a column name.
  *
  * If you want to cancel abstractions simply pass _null_ as affix argument.
  * @example
  * pers.setAbstractAffix("discounted_", "prefix");
  * //if Product doesn't have price column but a discounted_price
  * //column, the returning object will have a .price column whose
  * //value is filled with the value of discount_price:
  * pers.loadById("Product", 98, "id, price", function(err, product){
  *   console.log(product.price); //value of discounted_price column
  * });
  * @see [Field abstraction over affix](#field-abstraction-over-affix)
  * @param {string|null} affix A string that will be appended or prepended to all the field names when persistanz can't find the given field.
  * @param [type='suffix'] {string} Possible values are "prefix" and "suffix". Depending on this value, affix will be appended or prepended.
  * @return {undefined}
  */
  this.setAbstractAffix=function(affix, type)
  {
    if (affix==null) return pers.abstractAffix=null;
    if (!type) type="suffix"
    if (type!=="suffix" && type!=="prefix")
      throw new Error("Abstract affix type must be one of suffix, prefix");
    pers.abstractAffix={type: type, affix: affix};
  }

  /******************** end of methods ********************/

  function returnXError(cb)
  {
    var err=new Error("No transaction object supplied for hydrateX.");
    return cb ? cb(err) : Promise.reject(err);
  }

  function parseDbUrl(connString)
  {
    let parsed=require("url").parse(connString);
    let adapter=parsed.protocol.split(":")[0].trim().toLowerCase();
    let parts=parsed.auth!=undefined ? parsed.auth.split(':') : [null, null];

    return {
      adapter,
      host: parsed.host,
      port: parsed.port ? parseInt(parsed.port) : undefined,
      user: parts[0],
      password: parts[1],
      database: adapter==="sqlite3" ? parsed.pathname : parsed.pathname.substring(1),
    };
  }

  function findModelDefFromName(modelName)
  {
    var modelDef=modelDefs[modelName];
    if (!modelDef)
      throw new Error("No model with the name '"+modelName+"' is registered.");
    return modelDef;
  }

  function findModelDefFromObject(object)
  {
    if (typeof object!=="object" || object.constructor==null || object.constructor.name==='')
      throw new Error("Object is null or has no constructor or no constructor name.");

    var modelName=object.constructor.name;
    return findModelDefFromName(modelName);
  }

  function saveAs(tx, object, modelName, forceInsert, cb)
  {
    var o=pers.cast(object, modelName);
    return save(tx, o, forceInsert, cb);
  }

  //TODO: WE assumed there is always a primary key, this is not ok, fix it.
  function save(tx, object, forceInsert, cb)
  {
    var fn=co.wrap(function *() {

      var conn=tx || pers.adapter;
      var modelDef=findModelDefFromObject(object);

      var cls=pers.orm.classes[modelDef.table];
      var pkName=cls.pkName, pkValue=object[pkName];
      var saveProps={}, values=[];
      var isInsert=pkValue==null || forceInsert;

      var ret={
        object: object,
        status: null, //saved or cancelled (if cancelled by before save);
        command: isInsert ? "insert" : "update",
        lastInsertId: null
      }

      var continueSave=true;
      if (typeof object.beforeSave === 'function')
        continueSave = object.beforeSave.length===3
          ? yield common.pc(object.beforeSave, object, [tx, ret.command])
          : yield object.beforeSave(tx, ret.command);

      if (!continueSave)
      {
        ret.status="cancelled";
        return yield Promise.resolve(ret);
      }

      //Select the props to be saved. Exclude many-to-one and many-to-many fields
      //as well as unset ones.
      for (var propName in cls.props)
      {
        var prop=cls.props[propName];
        if (!prop.boundFk && prop.toManyClass==undefined && object[propName]!==undefined)
        {
          saveProps[pers.escapeId(propName)]=object[propName];
          values.push(object[propName]);
        }
      }

      //if subclass, check first if discrimitor is set. If not set.
      if (modelDef.discriminator && object[modelDef.discriminator]==undefined)
      {
        saveProps[pers.escapeId(modelDef.discriminator)]=object.constructor.name;
        values.push(object.constructor.name);
      }

      if (!values.length) return Promise.reject(new Error("Can't save: no fields on the object are set."));

      var tableName=pers.escapeId(cls.name);

      if (isInsert)
      {
        var fields=Object.keys(saveProps).join(', ');
        //http://stackoverflow.com/questions/12503146/create-an-array-with-same-element-repeated-multiple-times-in-javascript
        var placeHolders=Array(values.length).fill("?").join(',');
        mainQuery="INSERT INTO " + tableName + " (" + fields + ") values (" + placeHolders + ")";
        if (pers.adapter.name==='postgres')
          mainQuery+=" RETURNING " + pers.escapeId(pkName);
      }
      else
      {
        var escapedPkName=pers.escapeId(pkName);
        var columns=Object.keys(saveProps).map(function(key, i){
          return key + "=?";
        }).join(', ');

        values.push(pkValue);
        mainQuery="UPDATE " + tableName + " SET " + columns +
                " WHERE " + escapedPkName + "=?";
      }

      var queryResult=yield conn.exec(mainQuery, values);

      //rowCount is very important, if 0, not saved.
      var lastInsertId=null;
      if (!queryResult.rowCount)
        ret.status="not-saved";
      else
      {
        ret.status="saved";
        if (isInsert)
          lastInsertId=queryResult.lastInsertId;

        if (lastInsertId!==null && !forceInsert)
          object[pkName]=lastInsertId;
      }

      ret.object=object;
      ret.lastInsertId=lastInsertId;

      if (typeof object.afterSave === 'function' && ret.status==="saved")
        if (object.afterSave.length===3)
          yield common.pc(object.afterSave, object, [tx, ret.command]);
        else
          yield object.afterSave(tx, ret.command);

      return yield Promise.resolve(ret);
    });

    if (!cb) return fn();
    fn().then(function(val){
      cb.call(object, null, val);
    },function(err){
      cb.call(object, err, null);
    });
  }

  function loadById(tx, modelName, id, fields, cb)
  {
    var fn=co.wrap(function*(){
      var modelDef=findModelDefFromName(modelName);
      var pkName=pers.orm.classes[modelDef.table].pkName;
      var select= fields==null ? "*" : fields;
      var results=yield pers.q(tx).f(modelName).w("{"+pkName+"}=?", id).l(1).s(select).exec();
      return results.pop() || null;
    });

    if (!cb) return fn();
    fn().then(function(val){
      cb.call(null, null, val);
    },function(err){
      cb.call(null, err, null);
    });
  }

  function deleteById(tx, typeName, id, cb)
  {
    var o=pers.cast({}, typeName);
    var modelDef=findModelDefFromName(o.constructor.name);
    var cls=pers.orm.classes[modelDef.table];
    o[cls.pkName]=id;
    return deleteObject(tx, o, cb);
  }

  function deleteObject(tx, object, cb)
  {
    var fn=co.wrap(function *() {

      var conn=tx || pers.adapter;
      var modelDef=findModelDefFromObject(object);
      var cls=pers.orm.classes[modelDef.table];
      var pkName=cls.pkName;
      var pkValue=object[pkName];

      if (pkValue==null)
        return yield Promise.reject(new Error("Object must have primary key set to be deleted."));

      var ret={
        status: null,
        object: object,
        command: "delete"
      }

      var continueDelete=true;
      if (typeof object.beforeDelete === 'function')
        continueDelete = object.beforeDelete.length === 2
          ? yield common.pc(object.beforeDelete, object, [tx]) //has callback
          : yield object.beforeDelete(tx); //returns promise

      if (!continueDelete)
      {
        ret.status="cancelled";
        return yield Promise.resolve(ret);
      }

      var escapedTable=pers.escapeId(modelDef.table);
      var escapedPkName=pers.escapeId(pkName);
      mainQuery="DELETE FROM " + escapedTable + " WHERE " + escapedPkName + "=?";
      var queryResult=yield conn.exec(mainQuery, pkValue);

      ret.status= queryResult.rowCount ? "deleted" : "not-deleted";

      if (typeof object.afterDelete === 'function' && ret.status==="deleted")
        if (object.afterDelete.length === 2)
          yield common.pc(object.afterDelete, object, [tx]);
        else
          yield object.afterDelete(tx);

      return yield Promise.resolve(ret);
    });

    if (!cb) return fn();
    fn().then(function(val){
      cb.call(object, null, val); //TODO: let's return true or false based on deleted row count.
    },function(err){
      cb.call(object, err, null);
    }).catch(function(err){
      //console.log("_>",err)
    })
  }

  function checkOrmErrors()
  {
    var remaining=ormErrors.filter(function(errDef){
      var cls=pers.orm.classes[errDef.clsName];
      if (errDef.type==='tomany')
      {
        //we must check every property because we don't have a reverse index
        //from remoteTable to the cls.
        for (var propName in cls.props)
        {
          var prop=cls.props[propName];
          if (prop.toManyClass==undefined) continue;
          //so user indeed added a tomany property that maps to the remoteFk that we couldn't.
          if (prop.toManyClass===errDef.remoteTable && prop.fkName===errDef.fkName)
            return false;
        }
        return true;
      }
      else //toone
      {
        var fkField=cls.props[errDef.fkName];
        return !(fkField.mappingProp && cls.props[fkField.mappingProp] && cls.props[fkField.mappingProp].boundFk===errDef.fkName);
      }
    });

    if (remaining.length)
      throw new Error("persistanz.create errors:\n"+remaining.map(function(err, i){
        return (1+i)+") "+err.message;
      }).join("\n"));
  }

  function registerModel(model, extend, table, modelOptions)
  {
    if (typeof model!=="function") throw new Error("One of your models is not a function.");
    var modelName=model.prototype.constructor.name;
    if (modelName==='') throw new Error("Anonymous functions cannot be used as models.");
    if (table==null || table.trim()==="") throw new Error("Database table of one of your models couldn't be determined. ");
    if (!pers.orm.classes[table]) //
      throw new Error("No table with the name '"+table+"' found in the database.");

    if (extend)
    {
      var fake=generateModel(modelName);
      var origConstructor=model.prototype.constructor;
      Object.assign(model.prototype, fake.prototype);
      Object.assign(model, fake);
      model.prototype.constructor=origConstructor;
    }

    if (modelDefs[modelName]) throw new Error("A model with the name '" + modelName + "' is already registered.'");
    //if (modelDefsByTableName[table]) throw new Error("Duplicate model mapping to table '" + table + "'.");
    var modelDef={model:model, table:table};
    if (modelOptions && modelOptions.bridgeFields) modelDef.bridgeFields=modelOptions.bridgeFields;
    if (modelOptions && modelOptions.discriminator) modelDef.discriminator=modelOptions.discriminator;
    modelDefs[modelName]=modelDef;
    pers.models[modelName]=model;
    modelDefsByTableName[table]=modelDefs[modelName];

    //fix related orm items based on bridgeFields
    if (modelOptions && modelOptions.bridgeFields!=null)
    {
      var props=pers.orm.classes[table].props;
      for (var bfName in modelOptions.bridgeFields)
      {
        var fkName=modelOptions.bridgeFields[bfName];
        //first check if fkName exists:
        if (!props[fkName] || props[fkName].fk!='1')
          throw new Error("No field with the name '" + fkName + "' exists in table '"
            + table + "' or it is not a foreign key.'");
        //if already set in orm mapping, remove the old one:
        if (props[props[fkName].mappingProp])
          delete props[props[fkName].mappingProp];
        //make sure name is not colliding:
        if (props[bfName])
          throw new Error("Bridge field '" + bfName + "' in table '"+ table + "' creates a name collision.");
        //seems legit. first fix the foreign key property
        props[fkName].mappingProp=bfName;
        //then create a new bridge property:
        props[bfName]={
          name: bfName,
          boundFk: fkName,
          oneToOneClass: props[fkName].fkOfClass
        }
      }
    }
  }

  function handleToManyConfiguration()
  {
    for (var m of pers.options.models)
    {
      if (!m.toManyFields) continue;
      for (var toManyFieldName in m.toManyFields)
      {
        var remoteFkDescription=m.toManyFields[toManyFieldName];
        var parts=remoteFkDescription.split('.');
        if (parts.length!==2) throw new Error("Values in toManyFields must be in ModelName.foreignKeyColumnName format. "+
          "You gave '"+remoteFkDescription+"' ");
        //check if the remote model exists:
        var remoteModel=findModelDefFromName(parts[0]);
        //check if the remote model has the specified column and it is a foreign key:
        var remoteFk= pers.orm.classes[remoteModel.table].props[parts[1]];
        if (!remoteFk) throw new Error("No column with the name '"+parts[1]+"' in the table '"+remoteModel.table+"' is found.");
        if (remoteFk.fkOfClass==undefined) throw new Error("Column '"+parts[0]+"."+parts[1]+"' is not a foreign key.");
        //m is model option, find the real model:
        var model= findModelDefFromName( (typeof m.model==="string") ? m.model : m.model.prototype.constructor.name);
        //if already set in orm mapping, remove the old one, but only if it is removable:
        var cls=pers.orm.classes[model.table];
        var oldToManyProp=cls.props[toManyFieldName];
        if (oldToManyProp)
        {
          if (oldToManyProp.toManyClass==undefined || oldToManyProp.toManyClass!==remoteModel.table)
            throw new Error("There is already a field named '"+toManyFieldName+"' in the model '"+
              model.prototype.constructor.name+"' and it can't be renamed because it is not a toMany field "+
              "or a toMany field mapping to another model.");

          delete cls.props[toManyFieldName];
        }
        //seems legit, delete the old one if exits:
        for (var propName in cls.props)
        {
          var prop=cls.props[propName];
          if (prop.toManyClass==undefined) continue;
          if (prop.toManyClass===remoteModel.table && prop.fkName===remoteFk.name)
            delete cls.props[propName];
        }
        //seems legit, add the new field:
        cls.props[toManyFieldName]={
          name:toManyFieldName,
          toManyClass:remoteModel.table,
          fkName: remoteFk.name
        }
      }
    }
  }

  function createModels(modelDefList, generateDefaultModels)
  {
    //user models:
    for (var i=0; i<modelDefList.length; i++)
    {
      var modelDef=modelDefList[i];
      if (typeof modelDef==="function")
        registerModel(modelDef, pers.options.extend, modelDef.prototype.constructor.name);
      else
      {
        var table= (modelDef && modelDef.table) ? modelDef.table : null;
        var model, extend;
        if (typeof modelDef.model==='string') //use this name for a sys generated model
        {
          //basically a rename of a default model:
          model=generateModel(modelDef.model, pers.options.baseModel);
          extend=false;
        }
        else //normal constructor function
        {
          model=modelDef.model;
          extend=modelDef.extend!==undefined ? modelDef.extend : pers.options.extend;
        }

        if (table==null) table=model.prototype.constructor.name;
        registerModel(model, extend, table, modelDef);

        //subModels:
        if (modelDef.submodels!=null)
        {
          if (!modelDef.submodels instanceof Array) throw new Error("submodels must be an Array.");

          for (var subModel in modelDef.submodels)
            modelDef.submodels[subModel].table=table;

          createModels(modelDef.submodels, false);
        }
      }
    }

    if (!generateDefaultModels) return;

    //default models:
    for (var name in pers.orm.classes)
    {
      //do not overwrite:
      if (modelDefsByTableName[name]) continue;
      var m=generateModel(name, pers.options.baseModel);
      registerModel(m, false, name);
    }
  }

  function generateModel(name, baseModel)
  {
    var f;
    if (baseModel)
    {
      //maybe we should eval this because of constructor name issue.
      f=function(){
        baseModel.call(this);
      };
      f.prototype = Object.create(baseModel.prototype);
      Object.assign(f, baseModel);
    }
    else
      f=function(){};

    f.prototype.constructor={name}; //very unfortunate :( funcs can't be renamed, f.name=.. doesn't work.

    f.prototype.save=function(cb){return pers.save(this, cb);}
    f.prototype.insert=function(cb){return pers.insert(this, cb);}
    f.prototype.delete=function(cb){return pers.deleteObject(this, cb)};
    f.prototype.hydrate=function(fieldList, cb){return pers.hydrate(this, fieldList, cb);};

    f.prototype.saveX=function(tx, cb){return pers.saveX(tx, this, cb);}
    f.prototype.insertX=function(tx, cb){return pers.insertX(tx, this, cb);}
    f.prototype.deleteX=function(tx, cb){return pers.deleteObjectX(tx, this, cb)};
    f.prototype.hydrateX=function(tx, fieldList, cb){return pers.hydrateX(tx, this, fieldList, cb);};

    f.cast=function(object){return pers.cast(object, name);}
    f.loadById=function(id, fields, cb){return pers.loadById(name, id, fields, cb);}
    f.save=function(object,cb){return pers.saveAs(object, name, cb);}
    f.insert=function(object,cb){return pers.insertAs(object, name, cb);}
    f.deleteById=function(id, cb){return pers.deleteById(name, id, cb);}
    f.loadByIdX=function(tx, id, fields, cb){return pers.loadByIdX(tx, name, id, fields, cb);}
    f.saveX=function(tx, object,cb){return pers.saveAsX(tx, object, name, cb);}
    f.insertX=function(tx, object,cb){return pers.insertAsX(tx, object, name, cb);}
    f.deleteByIdX=function(tx, id, cb){return pers.deleteByIdX(tx, name, id, cb);}
    f.q=f.query=function(tx){return pers.q(tx).f(name);}
    return f;
  }
}
