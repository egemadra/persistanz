"use strict";
var co=require("co");
var helper=require("../helper.js");
var sqlite3=require('sqlite3').verbose();

function PersSqlite3(dbConfig)
{
  this.name="sqlite3";
  this.connection=null;
  this.config=dbConfig;
  delete this.config.adapter; //just in case..
}

PersSqlite3.prototype.escapeId = function(expression) {
  return '"' + expression.replace(/"/g, '""') + '"';
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
    return yield helper.promisifyCall(me.connection.close, me.connection);
  });
}

//insert, update, delete, begin, commit, rollback etc is called with exec.
//returns a abstracted common result having lastInsertId and rowCount
PersSqlite3.prototype.exec=function(query, values)
{
  if (values==undefined) values=[];
  if (!Array.isArray(values)) values=[values];

  //run method has a very unusual signature where "this" value is the return value.
  //https://github.com/mapbox/node-sqlite3/wiki/API
  return new Promise( (resolve, reject) => {
    this.connection.run(query, values, function(err) {
      if (err != null) return reject(err);
      return resolve({
        lastInsertId: this.lastID,
        rowCount: this.changes,
      });
    });
  });
}

//select queries:
PersSqlite3.prototype.query=function(query, values)
{
  if (values==undefined) values=[];
  if (!Array.isArray(values)) values=[values];
  var me=this;

  return co(function*(){
    return yield helper.promisifyCall(me.connection.all, me.connection, [query, values]);
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
  //sqlite has no pool so we simply create another connection:
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

module.exports=PersSqlite3;
