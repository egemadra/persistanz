"use strict";
var helper = require("../helper.js");
var sqlite3 = require('sqlite3').verbose();

function PersSqlite3 (dbConfig) {
  this.name = "sqlite3";
  this.connection = null;
  this.config = dbConfig;
}

PersSqlite3.prototype.escapeId = function(expression) {
  return '"' + expression.replace(/"/g, '""') + '"';
}

//connect.
PersSqlite3.prototype.connect = function (cb) {
  var p = new Promise( (resolve, reject) => {
    var retCb = err => err ? reject(err) : resolve(this);
    this.connection = new sqlite3.Database(this.config.database, sqlite3.OPEN_READWRITE, retCb);
  });
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

//destroy the pool (sqlite is poolless, so it closes the only connection)
PersSqlite3.prototype.close = function (cb) {
  var p = helper.promisifyCall(this.connection.close, this.connection);
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

//insert, update, delete, begin, commit, rollback etc is called with exec.
//returns a abstracted common result having lastInsertId and rowCount
PersSqlite3.prototype.exec = function(query, values, cb) {
  if (values == undefined) values = [];
  if (!Array.isArray(values)) values = [values];

  //run method has a very unusual signature where "this" value is the return value.
  //https://github.com/mapbox/node-sqlite3/wiki/API
  var p = new Promise( (resolve, reject) => {
    this.connection.run(query, values, function(err) {
      if (err != null) return reject(err);
      return resolve({
        lastInsertId: this.lastID,
        rowCount: this.changes,
      });
    });
  });

  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

//select queries:
PersSqlite3.prototype.query = function (query, values, cb) {
  if (values == undefined) values = [];
  if (!Array.isArray(values)) values = [values];

  var p = helper.promisifyCall(this.connection.all, this.connection, [query, values]);
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}


PersSqlite3.prototype.eventedQuery = function (events, sql, values, inTransaction) {
  if (values == undefined) values = [];
  if (!Array.isArray(values)) values = [values];

  var adapterP = inTransaction ? new Promise( (r, x) => r(this) ) : this.acquire();
  return adapterP.then( adapter => {

    return new Promise( (resolve, reject) => {

      var onRow = (err, row) => {
        if (err) { //can only happen if a connection error occurs in the middle.
          adapter.destroy(); //pretty much meaningless.
          if (events.error) events.error.forEach(e => e(err));
        }

        if (events.object) events.object.forEach(e => e(row));
      }

      var onComplete = (err, nrOfRows) => {
        if (err) {
          adapter.destroy();
          if (events.error) events.error.forEach(e => e(err));
          return reject(err);
        } else {
          if (! inTransaction) adapter.destroy();
          if (events.end) events.end.forEach( e => e() );
          return resolve(true);
        }
      }

      adapter.connection.each(sql, values, onRow, onComplete);

    });

  });
}

//aquire from pool
PersSqlite3.prototype.acquire = function (cb) {
  //sqlite has no pool so we simply create another connection:
  var conn = new PersSqlite3(this.config);
  var p = helper.promisifyCall(conn.connect, conn);
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

//release connection to pool
PersSqlite3.prototype.release = function (cb) {
  var p = this.close();
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

//destroy connection to prevent going into pool
PersSqlite3.prototype.destroy = function (cb) { //individual connection
  var p = this.close();
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersSqlite3.prototype.begin = function (options, cb) {
  var p = this.exec("BEGIN");
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersSqlite3.prototype.commit = function (cb) {
  var p = this.exec("COMMIT");
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersSqlite3.prototype.rollback = function (cb) {
  var p = this.exec("ROLLBACK");
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

module.exports = PersSqlite3;
