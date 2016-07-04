//only for documentation.
/**
* @class
*/
function Model()
{
  /**
  * Tries to save an object. Equivalent to [Persistanz.save](#Persistanz#save)
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type.
  */
  this.save=function(cb){return pers.save(this, cb);}

  /**
  * Tries to perform an INSERT operation. Equivalent to [Persistanz.insert](#Persistanz#insert)
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type.
  */
  this.insert=function(cb){return pers.insert(this, cb);}

  /**
  * Tries to delete an object. Equivalent to [Persistanz.deleteObject](#Persistanz#deleteObject)
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type.
  */
  this.delete=function(cb){return pers.deleteObject(this, cb)};

  /**
  * Tries to save an object in a transaction context. Equivalent to [Persistanz.saveX](#Persistanz#saveX)
  * @param {persistanz.PersTransaction} tx A transaction object.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type.
  */
  this.saveX=function(tx, cb){return pers.saveX(tx, this, cb);}

  /**
  * Tries to do an INSERT operation in a transaction context. Equivalent to [Persistanz.insertX](#Persistanz#insertX)
  * @param {persistanz.PersTransaction} tx A transaction object.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type.
  */
  this.insertX=function(tx, cb){return pers.insertX(tx, this, cb);}

  /**
  * Tries to delete an object in a transaction context. Equivalent to [Persistanz.deleteObjectX](#Persistanz#deleteObjectX)
  * @param {persistanz.PersTransaction} tx A transaction object.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to the saveResult type.
  */
  this.deleteX=function(tx, cb){return pers.deleteObjectX(tx, this, cb)};


  /**
  * Called by persistanz before an INSERT or UPDATE query.
  *
  * Called when the object is about to be saved. If the save query is being
  * performed within a transaction, tx argument is passed the transaction object.
  * tx is null for operations outside of a transaction. So if you used a transaction
  * somewhere you should check if tx value is null. If you need to perform
  * queries and tx is not null, use the X-ending methods.
  * Otherwise user normal methods.
  *
  * If you provide the callback slot in the arguments, it is passed a callback
  * function with the signature (error, result) and you should fill the result
  * param a boolean return value. If you didn't provide the cb slot,
  * persistanz expects your hook to
  * return a promise which resolves to a boolean value.
  * If this value is true persistanz goes ahead and attempts to persist your
  * object. If false, the save operation is canceled and the return value from
  * the save (or insert, saveAs etc) contains "cancelled" in its status member.
  *
  * @example
  * function User(){
  *   //We didn't put a callback in the signature,
  *   //so persistanz expects a Promise:
  *   this.beforeSave=function(tx, command){
  *     //Let's not allow empty passwords:
  *     if (command==="insert" && this.password==="")
  *       return Promise.resolve(false);
  *     return Promise.resolve(true);
  *   }
  * }
  *
  * //or with a callback:
  * function User(){}
  * User.prototype.beforeSave=function(tx, command, cb)
  * {
  *   if (command==="insert" && this.password==="")
  *     return cb(null, false);
  *   return cb(null, true);
  * }
  * @param {PersTransaction|null} tx A transaction object, if the save is within a transaction, null if not.
  * @param {string} command Reads either "insert" or "update" depending on the operation.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise<boolean>} A promise resolving to a boolean value.
  */
  this.beforeSave=function(tx, command, cb){}

  /**
  * Called by persistanz after an INSERT or UPDATE query.
  *
  * Works nearly identical to [.beforeSave](#Model#beforeSave) but return value is not used,
  * so if you put a callback in the signature just call it with any or no value.
  * Likewise, promise resolution value is discarded. This is because at
  * this point save operation has already taken place and can't be canceled anymore.
  *
  * @example
  * this.afterSave=function(tx, command){
  *   //Do whatever needed to be done after the user is saved...
  *   //And then, this must be called, with or without any value:
  *   return Promise.resolve();
  * }
  *
  * //or
  * this.afterSave=function(tx, command, cb){
  *   cb();
  * }
  * @param {PersTransaction|null} tx A transaction object, if the save was within a transaction, null if not.
  * @param {string} command Reads either "insert" or "update" depending on the operation.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to any or no value.
  */
  this.afterSave=function(tx, command, cb){}

  /**
  * Called by persistanz before a DELETE query.
  *
  * Works nearly identical to [.beforeSave](#Model#beforeSave) but command arg is missing,
  * because it is always a delete operation. cb(null, false) or
  * returning Promise.resolve(false) will cancel the delete operation, cb(null, true)
  * or returning Promise.resolve(true) will make the persistanz continue the delete operation.
  *
  * @example
  * //callback example, attached to prototype:
  * User.prototype.beforeDelete=function(tx, callback){
  *   //only delete if the user is currently not logged in.
  *   return callback(null, !this.isLoggedIn);
  * }
  *
  * //or
  * User.prototype.beforeDelete=function(tx){
  *   return Promise.resolve(!this.isLoggedIn);
  * }
  * @param {PersTransaction|null} tx A transaction object, if the delete operation is within a transaction, null if not.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise<boolean>} A promise resolving to a boolean value.
  */
  this.beforeDelete=function(tx, cb){}

  /**
  * Called by persistanz after a DELETE query.
  *
  * Works nearly identical to [.beforeDelete](#Model#beforeDelete) but delete
  * operation has already been attempted, so the return value does
  * not matter and is discarded. You still need to call the callback or resolve
  * a promise so that the program doesn't hang, waiting for your callback to complete.
  *
  * @param {PersTransaction|null} tx A transaction object, if the delete operation was within a transaction, null if not.
  * @param {function=} cb An optional callback in the (err, result) signature.
  * @return {Promise} A promise resolving to any or no value.
  */
  this.afterDelete=function(tx, cb){}
}

/**
* Queries the database and returns and instance of the Model whose id is specified or null if no row found.
*
* Equivalent to [Persistanz.loadById](#Persistanz#loadById)
* @param {string|numeric} id Primary key
* @param [fieldList='*'] {string} fields A comma separated field list to be added in the select clause.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} A promise resolving to the loaded object.
*/
Model.loadById=function(id, fields, cb){return pers.loadById(name, id, fields, cb);}

/**
* Tries to save the given object after casting to the Model.
*
* Equivalent to [Persistanz.saveAs](#Persistanz#saveAs)
* @param {object} object An object.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} A promise resolving to the saveResult type.
*/
Model.save=function(object,cb){return pers.saveAs(object, name, cb);}

/**
* Tries to save the given object after casting to the Model, using an INSERT query.
*
* Equivalent to [Persistanz.insertAs](#Persistanz#insertAs)
* @param {object} object An object.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} A promise resolving to the saveResult type.
*/
Model.insert=function(object,cb){return pers.insertAs(object, name, cb);}

/**
* Tries to delete a row whose table is the Model's table, and primary key is given in id param.
*
* Equivalent to [Persistanz.deleteById](#Persistanz#deleteById)
* @param {string|numeric} id A primary key value.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} A promise resolving to the saveResult type.
*/
Model.deleteById=function(id, cb){return pers.deleteById(name, cb);}

/**
* Queries the database in a transaction context and returns and instance of the Model whose id is specified or null if no row found.
*
* Equivalent to [Persistanz.loadByIdX](#Persistanz#loadByIdX)
* @param {persistanz.PersTransaction} tx A transaction object.
* @param {string|numeric} id Primary key
* @param [fieldList='*'] {string} fields A comma separated field list to be added to the select clause.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} A promise resolving to the loaded object.
*/
Model.loadByIdX=function(tx, id, fields, cb){return pers.loadByIdX(tx, name, id, fields, cb);}

/**
* Tries to save the given object in a transaction context after casting to the Model.
*
* Equivalent to [Persistanz.saveAsX](#Persistanz#saveAsX)
* @param {persistanz.PersTransaction} tx A transaction object.
* @param {object} object An object.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} A promise resolving to the saveResult type.
*/
Model.saveX=function(tx, object,cb){return pers.saveAsX(tx, object, name, cb);}

/**
* Tries to save the given object in a transaction context after casting to the Model, using an INSERT query.
*
* Equivalent to [Persistanz.insertAsX](#Persistanz#insertAsX)
* @param {persistanz.PersTransaction} tx A transaction object.
* @param {object} object An object.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} A promise resolving to the saveResult type.
*/
Model.insertX=function(tx, object,cb){return pers.insertAsX(tx, object, name, cb);}

/**
* Tries to delete a row in transaction context whose table is the Model's table, and primary key is given in id param.
*
* Equivalent to [Persistanz.deleteByIdX](#Persistanz#deleteByIdX)
* @param {persistanz.PersTransaction} tx A transaction object.
* @param {string|numeric} id A primary key value.
* @param {function=} cb An optional callback in the (err, result) signature.
* @return {Promise} A promise resolving to the saveResult type.
*/
Model.deleteByIdX=function(tx, id, cb){return pers.deleteByIdX(tx, name, cb);}

/**
* Prepares and returns a PersQuery instance, whose .from() method already called with the Model's name.
*
* Has an alias: **q()**
*
* Equivalent to [Persistanz.query](#Persistanz#query)
* @example
* //this:
* SomeModel.q().exec();
* //is identical to:
* pers.q().from("SomeModel").exec();
* @param [tx=null] {persistanz.PersTransaction} A Transaction instance.
* @return {PersQuery} A PersQuery instance.
*/
Model.query=function(tx){return pers.q(tx).f(name);}

/**
* @name Model.query
* @see [Model.query](#Model.query)
*/
Model.q=Model.query;

/**
* Casts the given object to a Model.
*
* Equivalent to [Persistanz.cast](#Persistanz#cast)
* @param {object} object Any javascript object to be typecasted to the Model.
* @return {object} An object whose type is Model.
*/
Model.cast=function(object){return pers.cast(object, name);}
