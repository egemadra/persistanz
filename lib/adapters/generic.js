//To document the Adapter interface of which methods the
//real adapters must implement.

/**
* The class that provides the Adapter interface.
*
* **Do not create instances directly, instead use [Persistanz.adapter.acquire()](#Persistanz#adapter) method.**
* @class
*/
function PersAdapter(dbConfig){

  /**
  * @type {string} Name of the adapter. Reads one of: "mysql", "postgres", "sqlite3"
  */
  this.name;

  /**
  * A connection or pool to the underlying database engine.
  * See the relevant documentation of the db binding you are using.
  *
  *   - In a Persistanz or PersQuery object, this is always a connection pool itself.
  *
  *   - In a Transaction, this is always a single connection acquired from the pool.
  *
  * ###### &nbsp;
  *
  * @type {Connection | ConnectionPool}
  */
  this.connection = null; //pool.
  this.config = dbConfig;
}

/**
* Escapes the expression argument which is an identifier.
*
* @param {string} expression A table name, column name or an alias to be escaped.
* @return {string} Escaped identifier.
*/
PersAdapter.prototype.escapeId = function (expression) {}

PersAdapter.prototype.connect = function (dbConfig) {}

/**
* Closes the connection pool.
*
* All of connections in the pool will gracefully disconnect and the pool will drain.
* Any calls after this method will fail.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} Returns a promise object resolving an unimportant value.
*/
PersAdapter.prototype.close = function (cb) {}

/**
* Executes an SQL query.
*
* Use this when you want to execute a custom SQL query. This method does not return
* any rows from the query. It returns an object with 2 properties:
*   - lastInsertId: If an insert operation is performed, this field holds the primary key of the last inserted row.
*   - rowCount: Number of rows affected by the query.
* ###### &nbsp;
* @param {string} sql An SQL query string.
* @param [values=null] {Array|string|numeric} List of values (or a single value if not Array) to replace the question mark place holders in the sql.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} Returns a promise which resolves to {lastInsertId, rowCount}
*/
PersAdapter.prototype.exec = function (query, values, cb) {}

/**
* Executes an SQL query.
*
* Use this when you want to execute a custom SQL query. This method returns rows.
*
* @param {string} sql An SQL query string.
* @param [values=null] {Array|string|numeric} List of values (or a single value if not Array) to replace the question mark place holders in the sql.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} Returns a promise which resolves to an Array of table rows.
*/
PersAdapter.prototype.query = function (query, values, cb) {}

PersAdapter.prototype.eventedQuery = function (events, sql, values, inTransaction) {}

/**
* Acquires a connection from the pool.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} A promise resolving to a database connection adapter.
*/
PersAdapter.prototype.acquire = function (cb) {}//from the pool

/**
* Relaeses a connection back to the pool.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} A promise resolving to an unimportant value.
*/
PersAdapter.prototype.release = function (cb) {}//individual connection

/**
* Destroys a connection. The pool will create a new one if need be.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} A promise resolving to an unimportant value.
*/
PersAdapter.prototype.destroy = function () {}//individual connection

PersAdapter.prototype.begin= function (options) {
  return this.exec("START TRANSACTION");
}

PersAdapter.prototype.commit = function() {
  return this.exec("COMMIT");
}

PersAdapter.prototype.rollback = function() {
  return this.exec("ROLLBACK");
}

PersAdapter.prototype.createOrm = function (ormErrors) {}

module.exports=PersAdapter;
