"use strict";
var co=require("co");
var PgPool=require('pg').Pool;

function PersPg(dbConfig)
{
  this.name="postgres";
  this.connection=null; //actually a pg pool.
  this.config=dbConfig;
  delete this.config.adapter; //just in case..
}

PersPg.prototype.escapeId = function(expression) {
  return '"' + expression.replace(/"/g, '""') + '"';
}

PersPg.prototype.connect=function(dbConfig)
{
  var me=this;
  return co(function*(){
    me.connection=new PgPool(me.config);
    return me;
  });
}

PersPg.prototype.close=function()
{
  return this.connection.end();
}

function execOrQuery(adapter, type, query, values)
{
  if (values==undefined) values=[];
  if (!Array.isArray(values)) values=[values];
  var pgSql=PersPg.placeholdersToDollar(query, values);

  //pg pool.query supports promises,
  return adapter.connection.query(pgSql, values).then(function(result){
    if (type==="query") return result.rows;
    //exec is tricky. pers sets returning primaryKey clause, so let's find it:
    var ret={rowCount: result.rowCount, lastInsertId: null};
    if (result.command==="INSERT" )
    {
      var firstRow=result.rows[0];
      if (firstRow!=undefined)
        ret.lastInsertId=firstRow[Object.keys(firstRow)[0]];
    }
    return ret;
  });
}

PersPg.prototype.exec=function(query, values)
{
  return execOrQuery(this, "exec", query, values);
}

PersPg.prototype.query=function(query, values)
{
  return execOrQuery(this, "query", query, values);
}

PersPg.prototype.eventedQuery=function(events, sql, values, inTransaction)
{
  if (values==undefined) values=[];
  if (!Array.isArray(values)) values=[values];
  var me=this;

  return co(function*(){

    var adapter=inTransaction ? me : yield me.acquire();
    adapter.connection
      .on('drain', function(a){
        //let's not give it back, because a transaction may use this later.
        if (!inTransaction)
          adapter.destroy();
      })
      .on('error', function(err){
        adapter.destroy();
      })

    //pass all the events added by user to the query
    var pgSql=PersPg.placeholdersToDollar(sql);
    var query=adapter.connection.query(pgSql, values);
    for (var eventName in events)
    {
      var eventArr=events[eventName];
      for (var ev of eventArr)
        query.on(eventName==="object" ? "row" : eventName, ev);
    }

    return new Promise(function(resolve, reject){
      query.on('error', function(err){
        return reject(err);
      });
      query.on('end', function(){
        return resolve(true);
      });
    });
  });
}

//https://github.com/brianc/node-pg-pool#acquire-clients-with-a-promise
PersPg.prototype.acquire=function() //from pool
{
  var me=this;
  return co(function*(){
    var conn=new PersPg(me.config);
    conn.connection=yield me.connection.connect();
    return conn;
  });
}

PersPg.prototype.release=function() //individual connection to pool.
{
  var r=this.connection.release();
  return {};
}

PersPg.prototype.destroy=function() //individual connection
{
  //https://github.com/brianc/node-postgres/wiki/pg
  this.connection.release(true); //true is destroy
  return {};
}

PersPg.prototype.begin=function(options)
{
  return this.exec("BEGIN");
}

PersPg.prototype.commit=function()
{
  return this.exec("COMMIT");
}

PersPg.prototype.rollback=function()
{
  return this.exec("ROLLBACK");
}

PersPg.placeholdersToDollar=function(sql, values)
{
  if (!sql.includes("?")) return sql;
  //rules:
  //1) ' starts a delim
  //2) unless it is ''
  //3) " starts a id delim
  //4) unless it is ""
  //does \ escape anything??
  let singleDelim=false, doubleDelim=false;
  let len=sql.length, pos=0, positions=[];
  while(pos<len)
  {
    var char=sql[pos];

    switch(char)
    {
      case "'":
        if (doubleDelim) break;
        if (sql[pos+1]!=="'")
          singleDelim=!singleDelim;
        else
          pos++;
        break;
      case '"':
        if (singleDelim) break;
        if (sql[pos+1]!=='"')
          doubleDelim=!doubleDelim;
        else
          pos++;
        break;
      case "?":
        if (singleDelim || doubleDelim) break;
        positions.push(pos);
        break;
    }
    pos++;
  }

  var sqln=sql, i=0;
  for (pos of positions)
  {
    var ph="$"+(i+1);
    var offset=pos+i*ph.length-(i*1);
    var firstPart=sqln.substr(0, offset);
    var lastPart=sqln.substr(offset+1);
    sqln=firstPart + ph + lastPart;
    i++
  }
  return sqln;
}

module.exports=PersPg;
