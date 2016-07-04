"use strict";
function DslResolver(pers, query, queryPrivate, modelDefsByTableName)
{
  this.pers=pers;
  this.q=query;
  this.p=queryPrivate.get(query);
  this.modelDefsByTableName=modelDefsByTableName;
}

DslResolver.prototype.resolveFieldFromParts=function(baseTable, parts, origFieldDef, forWhat, isExclude)
{
  var lastTable=baseTable;
  var prefixesString="";

  if (parts.length===1)
    return this.resolveSimple(lastTable, parts[0], origFieldDef, prefixesString, forWhat);

  var lastPart=parts.pop();
  var prefixes=[];

  while(parts.length)
  {
    var mapPropName=parts.shift();
    var mapProp=lastTable.props[mapPropName];
    if (!mapProp || (mapProp.oneToOneClass==undefined && mapProp.toManyClass==undefined))
    {
      this.p.errors.push("Can't resolve field '" + mapPropName + "' in the table '" + lastTable.name + "'.");
      return false;
    }

    var baseTableAlias=this.p.aliasMap[prefixes.join('.')];

    //to many class expression is found:

    if (mapProp.toManyClass) //mapProp is a toManyProp
    {
      if (forWhat!=="select" && forWhat!=="aliasSelect")
      {
        this.p.errors.push("toMany expressions are not allowed outside the select or selectAlias expressions: '"+origFieldDef+"'");
        return false;
      }

      var remainingParts=parts.concat([lastPart]);
      //add the remaining part as select clause:
      //tag is baseTableAlias.clean+"."+mapProp.name (#0.orders)
      this.q.toMany(mapProp, baseTableAlias.clean+"."+mapProp.name).s(remainingParts.join('.'));
      //id of the parent column is required so that we can have "where foreignKey in (ids)".
      var p=prefixes.join('.');
      if (p!=="") p+=".";
      var aReqField=p+lastTable.pkName;
      if (!this.p.requiredPkFields[aReqField])
        this.p.requiredPkFields[aReqField]={alias: baseTableAlias.clean, addedBy: "auto", field: aReqField};

      return false;
    }

    //mapProp is a bridge field (toOne)
    prefixes.push(mapProp.name);
    prefixesString=prefixes.join('.');

    if (!isExclude)
      this.p.joins[prefixesString]={"baseTableAlias":baseTableAlias, prop: mapProp };

    var a=this.q._createAlias(prefixesString, this.pers.orm.classes[mapProp.oneToOneClass].name);

    lastTable=this.pers.orm.classes[mapProp.oneToOneClass];

    this.p.mapInfo[a.clean]={
      propName:mapProp.name,
      className:lastTable.name,
      bindToAlias: baseTableAlias.clean,
      modelName: this.modelDefsByTableName[lastTable.name].model.prototype.constructor.name
    };

    if (forWhat==="index")
      this.p.indexAlias={alias: a.clean};

    //add id of the joined table, otherwise we can't differenciate if the field was empty or
    //no row was returned during the mapping process. This will get deleted if stays "auto".
    if (forWhat==='select' || forWhat==='selectAlias' || forWhat==='selectWith')
    {
      var aReqField=prefixesString+"."+lastTable.pkName;
      if (!this.p.requiredPkFields[aReqField])
        this.p.requiredPkFields[aReqField]={alias: a.clean, addedBy: "auto", field: aReqField};
    }
  }

  return this.resolveSimple(lastTable, lastPart, origFieldDef, prefixesString, forWhat);
}

DslResolver.prototype.resolveFields=function(fieldList, forWhat)
{
  var q=this.q;
  var resolvedFields=[], excludeFields=[];

  for (var i=0; i<fieldList.length; i++)
  {
    var origFieldDef=fieldList[i];
    var fieldDef=origFieldDef;
    //check if exclude field:
    var isExclude=fieldDef.substr(0,1)==='!';
    if (isExclude && forWhat!=='select')
    {
      this.p.errors.push("Negation symbol ! is not valid outside of select or selectWith sections.");
      break;
    }
    if (isExclude)
      fieldDef=fieldDef.substring(1).trim();

    if (fieldDef==="" || fieldDef==undefined)
    {
      this.p.errors.push("Found an empty field in the field list: '"+fieldList+"'");
      break;
    }

    /************************/
    var lastTable=this.p.baseTable;
    if (!lastTable) return;

    var parts=fieldDef.split('.');
    var resolved=this.resolveFieldFromParts(lastTable, parts, origFieldDef, forWhat, isExclude);
    if (resolved)
      if (isExclude)
        excludeFields=excludeFields.concat(resolved);
      else
        resolvedFields=resolvedFields.concat(resolved);
  }

  //diff the resolved set to remove excluded fields:
  var finalFields=resolvedFields.filter(function(x) {
    return excludeFields.indexOf(x) < 0;
  });

  //now if requiredPkFields has items that are not in the final list, add them:
  var forSelect=forWhat=="select" || forWhat=="selectWith" || forWhat=="selectAlias" || forWhat=="index";
  if (forSelect)
    for (var f in this.p.requiredPkFields)
    {
      if (finalFields.indexOf(f)<0)
      {
        finalFields.push(f);
        this.p.requiredPkFields[f].addedBy="auto";
      }
      else
        this.p.requiredPkFields[f].addedBy=forSelect ? "user" : "auto";
    }

  //unique:
  finalFields=finalFields.filter(function(elem, pos) {
    return finalFields.indexOf(elem) == pos;
  });

  return  finalFields;
}

DslResolver.prototype.resolveSimple=function(lastTable, part, origFieldDef, prefixesString, forWhat)
{
  var q=this.q;
  var newFields=[]; //dot separated form.

  if (prefixesString!=="") prefixesString+=".";

  if (part==='*')//fetch all fields.
  {
    if (forWhat!=='select')
    {
      this.p.errors.push("* symbol is not valid outside of select or selectWith sections.");
      return false;
    }
    //select all fieldnames that are not bridge props, then prefix them.
    newFields=Object.keys(lastTable.props).filter(function(propName) {
      var aProp=lastTable.props[propName];
      return aProp.oneToOneClass==undefined && aProp.toManyClass==undefined;
    }).map(function(propName){
      return prefixesString + propName;
    });
  }
  else //normal (not *) field:
  {
    var field=lastTable.props[part];

    //can't end with a bridge prop:
    if (field && (field.oneToOneClass!=undefined || field.toManyClass!=undefined))
      this.p.errors.push("'" + origFieldDef + "' represents a table, so you must specify some fields to be used in the query.");

    if (field!==undefined)
      newFields=[prefixesString+field.name];
    else //field not found, see if field abstraction is present:
    {
      if (this.pers.abstractAffix) //try if adding the abstract suffix resolves to a field name:
      {
        var possibleFieldName=
          this.pers.abstractAffix.type=='suffix'  ? part+this.pers.abstractAffix.affix : this.pers.abstractAffix.affix+part;
        if (!lastTable.props[possibleFieldName])
        {
          this.p.errors.push("Can't resolve field '" + part + "' in the table '" + lastTable.name + "'. (In one of selects)");
          return false;
        }
        else
        {
          if (forWhat==='select')
            newFields=[prefixesString+possibleFieldName + "=>" + part];
          else //other clauses "where" etc (even selectAlias) simply use the original field.
            newFields=[prefixesString+possibleFieldName];
        }
      }
      else
      {
        this.p.errors.push("Can't resolve field '" + origFieldDef + "' in the table '" + lastTable.name + "'. (In one of selects)");
        return false;
      }
    }
  }

  if (forWhat==="index" && newFields.length)
  {
    if (!this.p.indexAlias) this.p.indexAlias={alias: "#0"};
    this.p.indexAlias.field=part;
  }
  return newFields;
}

DslResolver.prototype.resolveCurlyExpression=function(forWhat, expression)
{
  //forwhat is one of: where, orderBy, groupBy, having, aliasSelect:
  var q=this.q, pers=this.pers, me=this;
  var r=/\{([^\}]+)\}/g;
  var regexResults, toResolve=[], curlyFields=[], replaced=expression;

  while ((regexResults = r.exec(expression)) !== null)
  {
    var curly=regexResults[0].trim();
    var toResolve=regexResults[1].trim();
    var resolved=this.resolveFields([toResolve], forWhat);
    var parts=resolved[0].split('.');
    var lastPart=parts.pop();
    var aliasKey=parts.join('.');
    replaced=replaced.replace(curly, me.p.aliasMap[aliasKey].alias+"."+pers.escapeId(lastPart));
  }

  return replaced;
}

module.exports=DslResolver;
