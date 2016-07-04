"use strict";
var co=require("co");
var common=require("../common.js");
var sqlite3=require('sqlite3').verbose();

function PersSqlite3(dbConfig)
{
  this.name="sqlite3";
  this.connection=null;
  this.config=dbConfig;
  delete this.config.adapter; //just in case..
}

//connect.
PersSqlite3.prototype.connect=function()
{
  var me=this;
  return new Promise(function(resolve, reject){
    var cb=function(err){
      if (err) return reject(err);
      return resolve(me);
    };
    me.connection=new sqlite3.Database(me.config.database, sqlite3.OPEN_READWRITE, cb);
  });
}

//destroy the pool (sqlite is poolless, so it closes the only connection)
PersSqlite3.prototype.close=function()
{
  var me=this;
  return co(function*(){
    return yield common.pc(me.connection.close, me.connection);
  });
}

//insert, update, delete, begin, commit, rollback etc is called with exec.
//returns a abstracted common result having lastInsertId and rowCount
PersSqlite3.prototype.exec=function(query, values)
{
  if (values==undefined) values=[];
  if (!Array.isArray(values)) values=[values];
  var me=this;

  return co(function*(){
    let result=yield common.pcThis(me.connection.run, me.connection, [query, values]);
    return {
      lastInsertId: result.lastID,
      rowCount: result.changes,
    };
  });
}

//select queries:
PersSqlite3.prototype.query=function(query, values)
{
  if (values==undefined) values=[];
  if (!Array.isArray(values)) values=[values];
  var me=this;

  return co(function*(){
    return yield common.pc(me.connection.all, me.connection, [query, values]);
  });
}


PersSqlite3.prototype.eventedQuery=function(events, sql, values, inTransaction)
{
  if (values==undefined) values=[];
  if (!Array.isArray(values)) values=[values];
  var me=this;

  return co(function*(){

    var adapter=inTransaction ? me : yield me.acquire();

    return new Promise(function(resolve, reject) {
      function onRow(err, row)
      {
        if (err) //can only happen if a connection error occurs in the middle.
        {
          adapter.destroy(); //pretty much meaningless.
          if (events.error)
            for (var e of events.error)
              e(err);
        }

        if (events.object)
          for (var e of events.object)
            e(row);
      }

      function onComplete(err, nrOfRows)
      {
        if (err)
        {
          adapter.destroy();
          if (events.error)
            for (var e of events.error)
              e(err);
          return reject(err);
        }
        else
        {
          if (!inTransaction) adapter.destroy();
          if (events.end)
            for (var e of events.end)
              e();
          return resolve(true);
        }
      }

      adapter.connection.each(sql, values, onRow, onComplete);

    });
  });
}

//aquire from pool
PersSqlite3.prototype.acquire=function()
{
  //sqlite has no pool so we simple create another connection:
  var me=this;
  return co(function*(){
    var conn=new PersSqlite3(me.config);
    yield conn.connect();
    return conn;
  });
}

//release connection to pool
PersSqlite3.prototype.release=function()
{
  return this.close();
}

//destroy connection to prevent going into pool
PersSqlite3.prototype.destroy=function() //individual connection
{
  return this.close();
}

PersSqlite3.prototype.begin=function(options)
{
  return this.exec("BEGIN");
}

PersSqlite3.prototype.commit=function()
{
  return this.exec("COMMIT");
}

PersSqlite3.prototype.rollback=function()
{
  return this.exec("ROLLBACK");
}

PersSqlite3.prototype.createOrm=function(ormErrors)
{
  var me=this;
  var fn=co.wrap(function*(){

    var orm={classes:{}};

    var conn=me.connection;

    //get tables:
    var result=yield me.query("SELECT name FROM sqlite_master WHERE type='table'");
    for (var row of result)
    {
      if (row.name==="sqlite_sequence") continue;
      var cls={name: row.name, props: {}};
      orm.classes[cls.name]=cls;
      var tName='"'+cls.name+'"';
      //get fields:
      var columnResult=yield me.query('PRAGMA table_info('+tName+');');
      for (var row of columnResult)
      {
        var prop={name: row.name}
        if (row.pk==1)
        {
          prop.pk=1;
          cls.pkName=prop.name;
        }
        cls.props[prop.name]=prop;
      }
      //get foreign keys:
      var fkResult=yield me.query('PRAGMA foreign_key_list('+tName+');');
      for (var fkInfo of fkResult)
      {
        var fkProp=cls.props[fkInfo.from]; //customerId
        fkProp.fk=1;
        fkProp.fkOfClass=fkInfo.table;
        var bridgeProp=common.findBridgeProp(fkProp, cls, ormErrors);
        if (bridgeProp)
        {
          fkProp.mappingProp=bridgeProp.name;
      		cls.props[bridgeProp.name]=bridgeProp;
        }
      }
    }

    common.setToManyProps(orm, ormErrors);
    return Promise.resolve(orm);
  });
  return fn();
}

module.exports=PersSqlite3;
