"use strict";
var co=require("co");
var p=new WeakMap();

function _(pt)
{
  return p.get(pt);
}

/**
* The class that provides the transaction interface.
*
* **Do not create instances directly, instead use [Persistanz.getTransaction()](#Persistanz#getTransaction) method.**
* @class
*/
function PersTransaction(txAdapter, transactionOptions)
{
  p.set(this, {
    active: false, //becomes inavtive upon rollback or commit
    txAdapter, //instance of single adapter (not pooled)
    transactionOptions //isolation/lock levels etc.
  });
}

PersTransaction.prototype.isActive = function() {
  return _(this).active;
}

function txCommand(tx, type, tryFn, cb)
{
  var ptx=_(tx);
  var fn=co.wrap(function*(){
    if (!ptx.active) throw new Error("Transaction is closed.");
    try{
      var val=yield tryFn(); //execute the command
      if (type==="rollback" || type==="commit") //these should invalidate the tx.
      {
        ptx.active=false;
        yield ptx.txAdapter.release();
      }
      return val;
    }
    catch(err)
    {
      ptx.active=false; //invalidate tx.
      if (type=="rollback") yield ptx.txAdapter.rollback(); //auto rollback
      yield ptx.txAdapter.destroy(); //let the pool give us a new one.
      throw err; //we rolled back but user needs to have the error.
    }
  });

  if (!cb) return fn();
  fn().then(function(val){
    return cb.call(null, null, val);
  },function(err){
    return cb.call(null, err, null);
  });
}

PersTransaction.prototype.begin=function()
{
  var me=this;
  return _(me).txAdapter.begin().then(function(res){
    _(me).active=true;
    return res;
  });
}

/**
* Executes an SQL query within the transaction.
*
* Use this when you want to execute a custom SQL query.
* @param {string} sql An SQL query string.
* @param [values=null] {Array|string|numeric} List of values (or a single value if not Array) to replace the question mark place holders in the sql.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} Returns a promise which resolves to {lastInsertId, rowCount}.
*/
PersTransaction.prototype.exec=function(sql, values, cb)
{
  var me=this;
  return txCommand(me, "exec", function(){return _(me).txAdapter.exec(sql, values);}, cb);
}

/**
* Executes an SQL query within the transaction.
*
* Use this when you want to execute a custom SQL query.
* @param {string} sql An SQL query string.
* @param [values=null] {Array|string|numeric} List of values (or a single value if not Array) to replace the question mark place holders in the sql.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} Returns a promise which resolves to an Array of table rows.
*/
PersTransaction.prototype.query=function(sql, values, cb)
{
  var me=this;
  return txCommand(me, "query", function(){return _(me).txAdapter.query(sql, values);}, cb);
}

/**
* Rolls back a transaction.
*
* After this call, the connection held by the transaction is released back to
* the connection pool, and thus, the transaction cannot be used anymore.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} Returns a promise whose resolution value is unimportant.
*/
PersTransaction.prototype.rollback=function(cb)
{
  var me=this;
  return txCommand(me, "rollback", function(){return _(me).txAdapter.rollback();}, cb);
}

/**
* Commits a transaction.
*
* After this call, the connection held by the transaction is released back to
* the connection pool, and thus, the transaction cannot be used anymore.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} Returns a promise whose resolution value is unimportant.
*/
PersTransaction.prototype.commit=function(cb)
{
  var me=this;
  return txCommand(me, "commit", function(){return _(me).txAdapter.commit();}, cb);
}

module.exports=PersTransaction;
