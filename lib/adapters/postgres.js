"use strict";
var PgPool = require('pg').Pool;

function PersPg(dbConfig) {
  this.name = "postgres";
  this.connection = null; //actually a pg pool.
  this.config = dbConfig;
}

function execOrQuery (adapter, type, query, values) {
  if (values == undefined) values = [];
  if (!Array.isArray(values)) values = [values];
  var pgSql = PersPg.placeholdersToDollar(query, values);

  //pg pool.query supports promises,
  return adapter.connection.query(pgSql, values).then(function(result){
    if (type === "query") return result.rows;
    //exec is tricky. pers sets returning primaryKey clause, so let's find it:
    var ret = {rowCount: result.rowCount, lastInsertId: null};
    if (result.command === "INSERT" )
    {
      var firstRow = result.rows[0];
      if (firstRow != undefined)
        ret.lastInsertId = firstRow[Object.keys(firstRow)[0]];
    }
    return ret;
  });
}

PersPg.prototype.escapeId = function (expression) {
  return '"' + expression.replace(/"/g, '""') + '"';
}

PersPg.prototype.connect = function (dbConfig, cb) {
  this.connection = new PgPool(this.config);
  var p = this.connection.connect().then( client => {
    client.release();
    return this;
  });
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersPg.prototype.close = function (cb) {
  var p = this.connection.end();
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersPg.prototype.exec = function (query, values, cb) {
  var p = execOrQuery(this, "exec", query, values);
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersPg.prototype.query = function (query, values, cb) {
  var p = execOrQuery(this, "query", query, values);
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersPg.prototype.eventedQuery = function(events, sql, values, inTransaction) {
  if (values == undefined) values = [];
  if (!Array.isArray(values)) values = [values];

  var adapterP = inTransaction ? Promise.resolve(this) : this.acquire();

  return adapterP.then( adapter => {
    adapter.connection
      .on('drain', function(a){
        //let's not give it back, because a transaction may use this later.
        if (! inTransaction) adapter.destroy();
      })
      .on('error', err => adapter.destroy());

    //pass all the events added by user to the query
    var pgSql = PersPg.placeholdersToDollar(sql);
    var query = adapter.connection.query(pgSql, values);

    for (var eventName in events) {
      var eventArr = events[eventName];
      eventArr.forEach( ev => query.on(eventName === "object" ? "row" : eventName, ev) );
    }

    return new Promise( (resolve, reject) => {
      query.on( 'error', err => reject(err) );
      query.on( 'end', () => resolve(true) );
    });
  });
}

//https://github.com/brianc/node-pg-pool#acquire-clients-with-a-promise
PersPg.prototype.acquire = function (cb) { //from pool
  var conn = new PersPg(this.config);
  var p = this.connection.connect().then(connection => {
    conn.connection = connection;
    return conn;
  })
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersPg.prototype.release = function (cb) { //individual connection to pool.
  var p = new Promise( (resolve, reject) => {
    try {
      this.connection.release();
      return resolve(true);
    } catch (err) { return reject(err); }
  });
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersPg.prototype.destroy = function (cb) { //individual connection
  var p = new Promise( (resolve, reject) => {
    try {
      //https://github.com/brianc/node-postgres/wiki/pg
      this.connection.release(true); //true is destroy
      return resolve(true);
    } catch (err) { return reject(err); }
  });

  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersPg.prototype.begin = function (options, cb) {
  var p = this.exec("BEGIN");
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersPg.prototype.commit = function (cb) {
  var p = this.exec("COMMIT");
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersPg.prototype.rollback = function (cb) {
  var p = this.exec("ROLLBACK");
  return cb ? p.then( r => cb(null, r) ).catch( e => cb(e) ) : p;
}

PersPg.placeholdersToDollar = function(sql, values)
{
  if (! sql.includes("?")) return sql;
  //rules:
  //1) ' starts a delim
  //2) unless it is ''
  //3) " starts a id delim
  //4) unless it is ""
  //does \ escape anything??
  let singleDelim = false, doubleDelim = false;
  let len = sql.length, pos = 0, positions = [];

  while (pos < len) {
    var char = sql[pos];

    switch(char) {
      case "'":
        if (doubleDelim) break;
        if (sql[pos+1] !== "'")
          singleDelim = ! singleDelim;
        else
          pos++;
        break;
      case '"':
        if (singleDelim) break;
        if (sql[pos+1] !== '"')
          doubleDelim = !doubleDelim;
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

  var sqln = sql, i = 0;
  for (pos of positions) {
    var ph = "$" + (i + 1);
    var offset = pos + i * ph.length - (i * 1);
    var firstPart = sqln.substr(0, offset);
    var lastPart = sqln.substr(offset + 1);
    sqln = firstPart + ph + lastPart;
    i++
  }
  return sqln;
}

module.exports = PersPg;
