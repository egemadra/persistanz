"use strict";

class OrmError {
  //available types: bridge, toMany and generic.
  //bridge and toMany are used to fix autogen bf name errors
  constructor(message, type, fixable, tableName, columnName, inModelName, fromModelName) {
    this.message = message;
    this.type = type || "generic";
    this.fixable = (fixable != undefined) ? fixable : this.type != "generic";
    this.tableName = tableName;
    this.columnName = columnName;
    this.inModelName = inModelName;
    this.fromModelName = fromModelName;
  }

  format (index) {
    var str = index + 1;
    str += ": " + this.message;
    if (!this.fixable) str += " THIS CANNOT BE FIXED in the configuration.";
    return str;
  }

  static throwAll (errors) {
    var messages = errors.map( (e, index) => e.format(index));
    throw new Error("persistanz.create errors:\n" + messages.join("\n"));
  }
}

var promisifyCall = (fn, context, args) => {
  if (args === undefined) args=[];

  return new Promise( (resolve, reject) => {
    var cb = (err, ret) => {
      if (err) return reject(err);
      return resolve(ret);
    }

    args.push(cb);
    fn.apply(context, args);
  });
};

module.exports = {

  checkSeparator (separator) {
    var illegal = "* ! { }";
    var msg = `Separator cannot contain whitespace or the following chars: '${illegal}'.`;
    //check illegal chars:
    for (var char of illegal.split(' ')) {
      if (separator.indexOf(char) != -1) throw new Error(msg);
    }
    //check whitespace:
    if (separator.trim() !== separator) throw new Error(msg);
    return separator;
  },

  split (exp, separatorRegex) {
    //http://stackoverflow.com/questions/7329972/how-to-split-a-string-in-js-with-some-exceptions
    return exp.replace(separatorRegex, '$1\u000B').split('\u000B');
  },

  //Caters to both callback and promise based async calls:
  polycall (fn, cb, $this, args) {
    if (! Array.isArray(args)) args = [args];
    if (! cb) return fn.apply(null, args);

    fn.apply(null, args).then(
      result => cb.call($this, null, result),
      err => cb.call($this, err, null)
    );
  },

  polycallTx (tx, fn, cb, $this, args) {
    if (! Array.isArray(args)) args = [args];
    if (! cb) return fn.apply(null, args)
      .then(result => result)
      .catch(err => {
        if (tx && tx.isActive()) tx.rollback();
        throw err;
      })

    fn.apply(null, args).then(
      result => cb.call($this, null, result),
      err => {
        if (tx && tx.isActive()) tx.rollback();
        cb.call($this, err, null);
      }
    );
  },

  //async fns that take a callback have 1 more argument.
  //we look at the argument count to decide if takes a callback, and if so
  //we call the callback through promisifyCall. If not, we call it regularly
  //as we can assume that it has to return a promise.
  polycallBasedOnSignatureLength (fn, context, args, sigLenForCb) {
      return fn.length === sigLenForCb
        ? promisifyCall(fn, context, args)
        : fn.apply(context, args);
  },

  promisifyCall,

  txError: (methodName, cb) => {
    var err = new Error("No transaction object supplied for " + methodName + ".");
    return cb ? cb(err) : Promise.reject(err);
  },

  OrmError,

  //tries to find a suitable bridge prop name.
  //returns a new bf name if found, null if not.
  createBridgeFieldName (fkName) {
    //sort them so that longest ones are tested first:
    var endings = [
      "_code", "_Code", "Code",
      "_id", "_Id", "_ID", "ID", "Id",
    ].sort( (a, b) => b.length - a.length );

    for (var ending of endings)
      if (fkName.endsWith(ending)) {
        var bfName = fkName.substr(0, fkName.length - ending.length);
        return bfName === '' ? null : bfName;
      }

    return null;
  },

  createBridgeFieldNameFromModelName (modelName) {
    return modelName.charAt(0).toLowerCase() + modelName.slice(1);
  },

  createToManyFieldName (modelName) {
    //name is simply the model name with first letter lowercased,
    //and in normal cases added an "s" to it. if it ends with an s or x
    //"es" is added.
    //http://stackoverflow.com/questions/1026069/capitalize-the-first-letter-of-string-in-javascript
    var name = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    var lastChar = name.substring(name.length - 1);

    if (["s","S","x","X"].indexOf(lastChar) != -1) return name + "es"; //box -> boxes

    if (["y","Y"].indexOf(lastChar) != -1) //proxy -> proxies
      return name.substr(0, name.length - 1) + "ies";

    return name + "s"; //cat -> cats
  },

  parseDbUrl: (connString) => {
    let parsed = require("url").parse(connString);
    let adapter = parsed.protocol.split(":")[0].trim().toLowerCase();
    let parts = parsed.auth != undefined ? parsed.auth.split(':') : [null, null];

    return {
      adapter,
      host: parsed.host,
      port: parsed.port ? parseInt(parsed.port) : undefined,
      user: parts[0],
      password: parts[1],
      database: adapter==="sqlite3" ? parsed.pathname : parsed.pathname.substring(1),
    };
  },

  identifyIgnoreTables(rawSchema, options) {
    if (! ("ignoreTables" in options)) return [];

    //handle cases where ignoreTables is a string or an array:
    var tables = null;

    if (typeof options.ignoreTables === 'string')
      tables = options.ignoreTables.split(",").map(t => t.trim());
    else if (Array.isArray(options.ignoreTables))
      tables = options.ignoreTables;

    if (tables)
      return Object.keys(rawSchema.tables).filter( t => tables.indexOf(t) != -1 );

    //handle the case where ignoreTables is a regexp
    if (options.ignoreTables instanceof RegExp)
      return Object.keys(rawSchema.tables).filter( t => t.search(options.ignoreTables) != -1);

    throw new Error("ignoreTables property in options must be either a string, Array or RegExp.");
  },

  //modifies the raw schema info obtained from schemax to be better usable
  //by the library. Also checks if non-supported things like composite
  //keys or tables without pks are used.
  persifyRawSchema (rawSchema, ignoreTables, ormErrors) {

    var debug = false;

    for (var tableName in rawSchema.tables) {
      if (ignoreTables.indexOf(tableName) != -1) {
        delete rawSchema.tables[tableName];
        continue;
      }

      var table = rawSchema.tables[tableName];

      //For easy debugging remove unnecessary things:
      /*
      if (debug) {
        delete table.columnCount;
        var delProps = ["position", "default", "nullable", "isPK", "isAI", "type"];
        for (var c in table.columns)
          delProps.forEach(dp => delete table.columns[c][dp]);
      }
      */

      var err = null;

      //check for pks:
      if (table.pks.length > 1)
        err = `Composite primary keys are not supported. Found in table: '${tableName}'.`;

      if (!table.pks.length)
        err = `Tables without a primary key column are not supported: '${tableName}'.`;

      if (err) ormErrors.push(new OrmError(err, "generic", false));

      //check for fks and create a bridge field if there is no incompatibility.
      for (var fkIndex in table.foreignKeys) {
        err = null;
        var fk = table.foreignKeys[fkIndex];
        if (fk.columns.length > 1)
          err = `Composite foreign keys are not supported. Found in table: '${tableName}'.`;

        if (err) {
          ormErrors.push(new OrmError(err, "generic", false));
          continue;
        }

        var fkColumnName = fk.columns[0].name;

        //some databases like sqlite3 allow a fk column to refer to more than
        //one column. We certainly can't handle that.
        if (table.columns[fkColumnName].fkInfo) {
          err = `'${table.name}.${fkColumnName}' is a foreign key to more than one` +
          ` column.`
          ormErrors.push(new OrmError(err, "generic", false));
          continue;
        }

        //if fk table is in ignore list, don't create fkInfo structure:
        if (ignoreTables.indexOf(fk.toTable) != -1) continue;

        //adjust fk column info so that it contains foreign table and column.
        //schemax adds all fk columns, since we accept only one, and verified
        //that we have only one, use it:
        table.columns[fkColumnName].fkInfo = {
          toTable: fk.toTable,
          toColumn: fk.columns[0].toColumn,
        }
      }
    }

    if (ormErrors.length) OrmError.throwAll(ormErrors);
    return rawSchema;
  },
}
