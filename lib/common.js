"use strict";
module.exports={

  pcThis: function(fn, context, args){
    if (args===undefined) args=[];

    return new Promise(function(resolve, reject){

      var cb=function(err){
        if (err) return (reject(err))
        resolve(this);
      }

      args.push(cb);
      fn.apply(context, args);
    });
  },
  pc: function(fn, context, args)
      {
        if (args===undefined) args=[];

        return new Promise(function(resolve, reject){

          var cb=function(err,ret){
            if (err) return (reject(err))
            return resolve(ret);
          }

          args.push(cb);

          fn.apply(context, args);
        });
      },

  //tries to find a suitable bridge prop name. returns the prop if found, false if not.
  findBridgeProp: function(fkProp, cls, ormErrors)
      {
      	//analyse the prop name;
      	//if it ends with Id, _id, _ID, _Id, ID we can assume the prop name.
      	//if collision or not found; mark but continue because it can be fixed later in model defs:
      	var bridgeFieldName=null;
      	var endings={3:["_id", "_Id", "_ID"], 2:["ID","Id"]}
      	for (var count in endings)
      	{
      		var ending=fkProp.name.substr(fkProp.name.length-count, count);
      		if (endings[count].indexOf(ending)>=0)
      		{
      			bridgeFieldName=fkProp.name.substr(0, fkProp.name.length-count);
      			break;
      		}
      	}

      	var bridgeError=false;
      	if (bridgeFieldName==null)
      	{
      		ormErrors.push({type: "toone", clsName: cls.name, fkName: fkProp.name,
      			message:"Bridge field for '" + cls.name + "." + fkProp.name + "' could not be created."});
      		bridgeError=true;
      	}

      	if (cls.props[bridgeFieldName])
      	{
      		ormErrors.push({type: "toone", clsName: cls.name, fkName: fkProp.name,
      			message:"Bridge field '" + bridgeFieldName + "' creates a name collision in table '" + cls.name + "'"});
      		bridgeError=true;
      	}

      	if(!bridgeError)
      	{
          return {
            name: bridgeFieldName,
      			boundFk: fkProp.name,
      			oneToOneClass: fkProp.fkOfClass
          }
      	}
        return false;
      },

  setToManyProps: function(orm, ormErrors)
      {
        for (var tableName in orm.classes)
        {
          for (var propName in orm.classes[tableName].props)
          {
            var f=orm.classes[tableName].props[propName];
            if (!f.fk) continue;

            //create a name.
            //name is simply the table name with first letter lowercased,
            //and in normal cases added an "s" to it. if it ends with an s or x
            //"es" is added.
            //http://stackoverflow.com/questions/1026069/capitalize-the-first-letter-of-string-in-javascript
            var name=tableName.charAt(0).toLowerCase() + tableName.slice(1);
            var lastChar=name.substring(name.length - 1);
            name+=["s","S","x","X"].indexOf(lastChar)<0 ? "s" : "es";
            //check that name does not cause collision:
            if (orm.classes[f.fkOfClass].props[name])
            {
              var m="toMany field '" + f.fkOfClass + "." + name + "' would cause a name collision "+
                ", so couldn't be created.";
              if (+orm.classes[f.fkOfClass].props[name].fkName!=undefined)
              {
                m+=" Furthermore, it can be mapped both to '"+orm.classes[f.fkOfClass].props[name].fkName+
                "' and '"+propName+"' of the table '"+tableName+"'.";
              }

              ormErrors.push({type:"tomany", clsName:f.fkOfClass, remoteTable: tableName, fkName:propName, message: m, });
              continue;
            }

            orm.classes[f.fkOfClass].props[name]={
              name:name,
              toManyClass:tableName,
              fkName: propName
            };
          }
        }
      }
}
