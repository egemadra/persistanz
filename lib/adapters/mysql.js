"use strict";
var co=require("co");
var helper=require("../helper.js")
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
    var result=yield helper.promisifyCall(adapter.connection.query, adapter.connection, [query, values]);
    return type==="query" ? result :  {
                                        lastInsertId: result.insertId,
                                        rowCount: result.affectedRows
                                      };

  });
}

PersMysql.prototype.escapeId = function(expression) {
  return '`' + expression.replace(/`/g, '``') + '`';
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
    return yield helper.promisifyCall(me.connection.end, me.connection);
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
    conn.connection=yield helper.promisifyCall(me.connection.getConnection, me.connection);
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

module.exports=PersMysql;
