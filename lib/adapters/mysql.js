"use strict";
var co=require("co");
var common=require("../common.js")
var mysql=require('mysql');

function PersMysql(dbConfig)
{
  this.name="mysql";
  this.connection=null; //pool.
  this.config=dbConfig;
  delete this.config.adapter; //just in case..
}

function execOrQuery(adapter, type, query, values)
{
  if (values==undefined) values=[];
  if (!Array.isArray(values)) values=[values];

  return co(function*(){
    var result=yield common.pc(adapter.connection.query, adapter.connection, [query, values]);
    return type==="query" ? result :  {
                                        lastInsertId: result.insertId,
                                        rowCount: result.affectedRows
                                      };

  });
}

PersMysql.prototype.connect=function(dbConfig)
{
  var me=this;
  return co(function*(){
    me.connection=mysql.createPool(me.config);
    return me;
  });
}

//close the pool
PersMysql.prototype.close=function()
{
  var me=this;
  return co(function*(){
    return yield common.pc(me.connection.end, me.connection);
  });
}

PersMysql.prototype.exec=function(query, values)
{
  return execOrQuery(this, "exec", query, values);
}

PersMysql.prototype.query=function(query, values)
{
  return execOrQuery(this, "query", query, values);
}

PersMysql.prototype.eventedQuery=function(events, sql, values, inTransaction)
{
  if (values==undefined) values=[];
  if (!Array.isArray(values)) values=[values];
  var me=this;

  return co(function*(){

    var adapter=inTransaction ? me : yield me.acquire();

    //pass all the events added by user to the query
    var query=adapter.connection.query(sql, values);
    for (var eventName in events)
    {
      var eventArr=events[eventName];
      for (var ev of eventArr)
        query.on(eventName==="object" ? "result" : eventName, ev);
    }

    return new Promise(function(resolve, reject){
      query.on('error', function(err){
        adapter.destroy();
        return reject(err);
      });
      query.on('end', function(){
        if (!inTransaction)
          adapter.destroy();
        return resolve(true);
      });
    });
  });
}


PersMysql.prototype.acquire=function() //from pool
{
  var me=this;
  return co(function*(){
    var conn=new PersMysql(me.config);
    conn.connection=yield common.pc(me.connection.getConnection, me.connection);
    return conn;
  });
}

PersMysql.prototype.release=function() //individual connection
{
  this.connection.release();
  return Promise.resolve(true);
}

PersMysql.prototype.destroy=function() //individual connection
{
  this.connection.destroy();
  return Promise.resolve(true);
}

PersMysql.prototype.begin=function(options)
{
  return this.exec("START TRANSACTION");
}

PersMysql.prototype.commit=function()
{
  return this.exec("COMMIT");
}

PersMysql.prototype.rollback=function()
{
  return this.exec("ROLLBACK");
}

PersMysql.prototype.createOrm=function(ormErrors)
{
  var me=this;
  var fn=co.wrap(function*(){
    //information_schema
    var schemaConfig=JSON.parse(JSON.stringify(me.config));
    schemaConfig.database="information_schema";
    var conn = mysql.createConnection(schemaConfig);
    yield common.pc(conn.connect, conn);

    var orm={classes:{}};

    //add tables.
    var q = "select TABLE_NAME from TABLES where TABLE_SCHEMA=?";
    var result=yield common.pc(conn.query, conn, [q, me.config.database]);
    for (var row of result)
      orm.classes[row.TABLE_NAME]={name: row.TABLE_NAME, props: {}};

    //add fields:
    q="select * from COLUMNS where TABLE_SCHEMA=?";
    result=yield common.pc(conn.query, conn, [q, me.config.database]);
    for (var row of result)
    {
      var cls=orm.classes[row.TABLE_NAME];
      var prop={name: row.COLUMN_NAME};
      if (row.COLUMN_KEY==='PRI')
      {
        prop.pk=1;
        cls.pkName=prop.name;
      }
      cls.props[prop.name]=prop;
    }

    //key constraints:
    q="SELECT * FROM KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_NAME is not null and TABLE_SCHEMA=?";
    result=yield common.pc(conn.query, conn, [q, me.config.database]);
    for (var row of result)
    {
      var cls=orm.classes[row.TABLE_NAME];
      var fkProp=cls.props[row.COLUMN_NAME]; //priorityId

      fkProp.fk=1;
      fkProp.fkOfClass=row.REFERENCED_TABLE_NAME;
      var bridgeProp=common.findBridgeProp(fkProp, cls, ormErrors);
      if (bridgeProp)
      {
        fkProp.mappingProp=bridgeProp.name;
        cls.props[bridgeProp.name]=bridgeProp;
      }
    }

    common.setToManyProps(orm, ormErrors);
    yield common.pc(conn.end, conn);
    return Promise.resolve(orm);
  });
  return fn();
}

module.exports=PersMysql;
