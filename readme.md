# Persistanz

Persistanz is a simple object relational mapping (ORM) library for SQL databases with unique features, where the main emphasis is on rapid development.

It is written in javascript and works on node.js.

**Persistanz only reads your database schema to figure out its structure and creates all of the default models with CRUD functionality, so you need to define yours only when you need additional functionality. Depending on your habits, this can lead to zero boilerplate, configuration and model definitions.**

## Overview

> 3 lines of javascript is all there is to enjoy a fully functional ORM layer.

```javascript
var Persistanz=require("persistanz"); //1
var pers=new Persistanz("sqlite3:/path/to/your/db.sqlite"); //2
pers.create().then(function(){ //3  

  //all models are generated and can be used in CRUD operations.
  pers.loadById("Product", 42, null, function(err, product){
    console.log(product.name);
    product.name="a different name";
    product.save();
  });

}).catch(function(err){
  //a not-so-lovable event took place.
});
```

## Features

* It supports MySQL, PostgreSQL and Sqlite3 databases with identical functionality.
* Automatically generates models based on database schema. You don't need to define your models if they only do CRUD operations.
* Convention over configuration: requires little or no configuration.
* Never touches your schema, gets meta-data from your database.
* Storage or object based access.
* All async methods can return a promise or take a callback, as you prefer.
* Respects your classes and queries. Doesn't force you to extend or decorate your models.
* Models are standard constructor functions and can be as simple as ```function Customer(){}```.
* Single table inheritance.
* Transaction support.
* ["Field abstraction over affix"](http://persistanz.34bit.net/#field-abstraction-over-affix)
* Many to many mappings in queries.
* Has a handsome [documenation web site](http://persistanz.34bit.net/) which covers the full functionality.
* [Has functional tests](http://persistanz.34bit.net/#tests)

As of this version, persistanz doesn't have support for the following, some of which is commonly found in orm software:

* Arbitrary "has-many", "belongs-to" configurations. All such things are based on foreign keys as of now. Maybe.
* Caching. Maybe.
* Deep object inserts or updates. (Saving objects along with the parent/child objects) Maybe.

## Is it good for me?

This is an opinionated package that aims to simplify and leverage the common database usage scenarios. It expects to be able to understand the relations between tables by looking at the schema, so the more your schema makes sense, the more this library is useful to you and you write less code.

<aside class="notice">
If you do any following, you probably won't like persistanz, because even with configuration they are not possible to fix:
<br /><br />
- You don't define primary keys for your tables.<br />
- You don't define foreign keys on database level and "has-many", "belongs-to" relations are only in your mind and code. (That means no MyISAM tables).<br />
- You do unusual stuff like mapping foreign keys to columns in more than one table, or non-primary-key columns.<br />
- You do arbitrary and custom connections using JOINs not involving foreign keys and/or primary keys.
</aside>

## Status and development

Currently in beta stage. I am actively working on this project as I need to use it myself. If you have any ideas, bug reports please contact me at egemadra@gmail.com

## Installation

```
npm install persistanz --save
```

> You will also need to install one of the following database bindings: mysql, postgres, sqlite3:

```
npm install mysql --save
npm install pg --save
npm install sqlite3 --save
```

## Samples

```javascript
var Pers=require("persistanz");
var pers=new Pers("mysql://username:password@host/database");

 //this call uses a callback, but promises can be used too:
pers.create(function(err, r){

  //At this point, persistanz created a default model
  //for each of your tables. They are named after the tables
  //and can do CRUD operations:
  var c=new pers.m.Customer();
  c.name="zubi";

  //Repository style where whole thing is governed by a central repo:
  //This is an insert because c.id is not set.
  //No callback is given to save, so returns a promise, and we can chain:
  pers.save(c).
    then(function(saveResult){
      console.log(c); //{ name: 'zubi', id: 1 }
      console.log(saveResult);
      /* {  object: { name: 'zubi', id: 1 },
            status: 'saved',
            command: 'insert',
            lastInsertId: 1 } */
      c.name="ege";
      //This time, let's use save on object instance.
      //Generates an update query because c.id is set.
      return c.save();
    }).then(function(saveResult)
    {
      console.log(c); //{ name: 'ege', id: 1 }
      console.log(saveResult); //... command: 'update', lastInsertId: 0
      return c.delete();
    }).then (function(result)
    {
      console.log(result); //status: 'deleted', ..., command: 'delete'
      console.log(pers.getQuery()); //DELETE FROM `Customer` WHERE `id` = 1
    }).catch(function(err){
      console.log("Something went wrong: ", err);
    });
});
```

```javascript
//let's create a few records first...
pers.m.Order.save({customerId:1, date:new Date()});
pers.saveAs({customerId:1, date:new Date}, "Customer");

pers.query()
  .from("Order")
  .select("id, date, customer.*")
  .where("{customer.id}=?", 1).
  .limit(5)
  .exec()
  .then(function(rows){
    console.log(rows);
    /*
    [ { id: 1,
    	dateTime: '2016-06-11 00:25:18',
    	customer: { id: 1, name: 'ege' } } ]
    */
  });
```

```javascript
//Concise form of the same. Clause ordering is not important.
//Let's return a promise:
var aPromise=pers.q()
  .w("{customer.id}=?", 1)
  .s("id, date, customer.*")
  .f("Order")
  .l(5)
  .exec();

//Same, but use model's static method.
//Note that .from is missing, because it is "Order".
var aPromise=pers.models.Order.q()
  .w("{customer.id}=?", 1)
  .s("id, date, customer.*")
  .l(5)
  .exec();

//also, many to many connections are allowed. Each customer object
//in the resulting array has an orders field, which is an array,
//containing zero or more Order objects.
var aPromise=pers.q().f("Customer").s("id, name, orders.*").exec();
```

## Documentation

Persistanz has a terrific documentation website where every feature is documented with code samples. Head over to the [persistanz.34bit.net](http://persistanz.34bit.net)

## Version history

### 0.4.1 2016-08-10

- Fixed: deleteById and deleteByIdX was broken when called as static on models.

### 0.4.0 2016-08-08

- Added "afterLoad" hook to models.
- Tabs are replaced with the spaces in the source code.

### 0.3.1 2016-07-12

- Fixed: .insert and .insertAs was causing the wrong primary key in the mapped object if the column is not a numeric/auto-increment type.
- Minor fixes in error messages, jsdoc corrections.

### 0.3.0 2016-07-06

- .toMany() method added. This allows a very flexible many-to-many queries.

### 0.2.1 2016-07-05

- .hydrate() and .hydrateX() methods added.
- .loadById() was not working with a callback, fixed.

### 0.2.0 2016-07-04 (now beta)

- Now in beta.
- any-db is removed from dependencies, and replaced with custom adapters.
- Partial one-to-many support in queries.
- Streaming row support in queries for big result sets.
- .index() method added to query interface.
- Pooling and driver options changed.
- Persistanz now accepts db config object along with a connection string.
- Persistanz .connection property is replaced with an .adaper property which returns a wrapped adapter now.
- .getTransaction() is now async.
- Sqlite3 was returning incorrect info on save and delete, fixed.
- The gorgeous documentation web site is created.

### 0.1.3

- A major error in the example code in the documentation fixed.
- A documentation error regarding the the default options is fixed.
- Some minor changes and corrections in the documentation.

### 0.1.0

- sqlite3 and PostgreSQL support added.
- insert and insertAs was broken, fixed.
- unnecessary node-mysql dependency removed.
- _not-saved_ and _not-deleted_ statuses added when saving or deleting has no effect.
- lastInsertId was not working correctly, fixed now. Returns only null if no insert.
- afterSave and and afterDelete hooks are called only if the operation had an effect.
- mapping for mysql changed to conform to the other 2.
- some internal testing prepared to ensure all adapters behave the same.

## License

MIT
