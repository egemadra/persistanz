"use strict";

var helper=require("../helper.js")
var mysql=require('mysql');

function PersMysql(dbConfig) {
  this.name="mysql";
  this.connection=null; //pool.
  this.config=dbConfig;
}

function execOrQuery(adapter, type, query, values) {
  if (values == undefined) values = [];
  if (!Array.isArray(values)) values = [values];

  var p = helper.promisifyCall(adapter.connection.query, adapter.connection, [query, values]);
  return p.then( result => {
    return type === "query"
      ? result
      : { lastInsertId: result.insertId, rowCount: result.affectedRows };
  });
}

PersMysql.prototype.escapeId = function(expression) {
  return '`' + expression.replace(/`/g, '``') + '`';
}

PersMysql.prototype.connect=function(dbConfig, cb) {
  var pool = mysql.createPool(this.config);
  //just test the connection:
  var p = helper.promisifyCall(pool.getConnection, pool).then( conn => {
    conn.release();
    this.connection = pool;
    return Promise.resolve(this);
  });

  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

//close the pool
PersMysql.prototype.close = function (cb) {
  var p = helper.promisifyCall(this.connection.end, this.connection);
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersMysql.prototype.exec = function (query, values, cb) {
  var p = execOrQuery(this, "exec", query, values);
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersMysql.prototype.query = function (query, values, cb) {
  var p = execOrQuery(this, "query", query, values);
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersMysql.prototype.eventedQuery = function(events, sql, values, inTransaction) {
  if (values == undefined) values = [];
  if (! Array.isArray(values)) values = [values];

  var adapterP = inTransaction ? Promise.resolve(this) : this.acquire();

  return adapterP.then( adapter => {
    //pass all the events added by user to the query
    var query = adapter.connection.query(sql, values);
    for (var eventName in events) {
      var eventArr = events[eventName];
      eventArr.forEach( ev => query.on(eventName === "object" ? "result" : eventName, ev) );
    }

    return new Promise( (resolve, reject) => {

      query.on('error', err => {
        adapter.destroy();
        return reject(err);
      });

      query.on('end', () => {
        if (! inTransaction) adapter.destroy();
        return resolve(true);
      });

    });
  });
}

PersMysql.prototype.acquire = function (cb) { //from pool
  var conn = new PersMysql(this.config);
  var p = helper.promisifyCall(this.connection.getConnection, this.connection).then( connection => {
    conn.connection = connection;
    return conn;
  });
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersMysql.prototype.release = function (cb) { //individual connection
  this.connection.release();
  return cb ? cb(true) : Promise.resolve(true);
}

PersMysql.prototype.destroy = function (cb) { //individual connection
  this.connection.destroy();
  return cb ? cb(true) : Promise.resolve(true);
}

PersMysql.prototype.begin = function (options, cb) {
  var p = this.exec("START TRANSACTION");
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersMysql.prototype.commit = function (cb) {
  var p = this.exec("COMMIT");
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersMysql.prototype.rollback = function (cb) {
  var p = this.exec("ROLLBACK");
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

module.exports = PersMysql;
