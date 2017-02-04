"use strict";
var prepare = require("./attic/prepare.js");
var conf = prepare.loadConfig();
var Persistanz = require("../lib/Persistanz.js");
var assert = require("chai").assert;
require('co-mocha');

describe("Basic CRUD without a configuration", function(done) {

  for (var adapterName of conf.applyTestsTo) {

    describe("running for " + adapterName, function() {

      var pers;

      (function(adapterName){
        before("Set up databases and initialize persistanz : " + adapterName , function *  () {
          var dbConf = conf.dbConfigs[adapterName];
          dbConf.adapter = adapterName;
          yield prepare.createTestDatabase(dbConf);
          pers = new Persistanz(dbConf);
          var result = yield pers.create();
          assert(result === true, "Create should succeed and must return true.");
        });
      })(adapterName);

      after("Destroy persistanz instance", function * () {
        yield pers.destroy();
      });

      /***********************************************************************/

      function checkDeleteResult(deleteResult, object, type, id, method) {
        ["command", "status", "object"].forEach(field => {
          assert(field in deleteResult, field + " must be a property in deleteResult.");
        });
        assert(deleteResult.command === "delete", "command must read delete.");
        assert(deleteResult.status === "deleted", "status must read deleted.");
        assert(typeof deleteResult.object.id === "number", "deleted object must have a numeric id.");
        assert(deleteResult.object.id > 0, "deleted object must have an id.");

        //checks with the initial object value. Valid only for pre typecast methods:
        if (["pers.deleteObject", "object.delete"].indexOf(method) > -1) {
          assert(object.id === deleteResult.object.id, "object id must be the same as that of deleteResult.");
          assert(object === deleteResult.object, "delete object is the same object as the original.");
        }

        assert(deleteResult.object instanceof type, "result object must be of correct type.");
        assert(deleteResult.object.id === id, "deleteResult object property must be what we set.");
      }

      function checkInsertResult(saveResult, object, type, name, method) {
        ["lastInsertId", "command", "status", "object"].forEach(field => {
          assert(field in saveResult, field + " must be a property in saveResult.");
        });
        assert(saveResult.command === "insert", "command must read insert.");
        assert(saveResult.status === "saved", "status must read saved.");
        assert(typeof saveResult.object.id === "number", "saved object must have a numeric id.");
        assert(saveResult.object.id > 0, "saved object must have an id.");

        //checks with the initial object value. Valid only for pre typecast methods:
        if (["pers.save", "pers.insert", "object.save", "object.insert"].indexOf(method) > -1) {
          assert(object.id === saveResult.object.id, "object id must be the same as that of saveResult.");
          assert(saveResult.lastInsertId === object.id, "lastInsertId must be the same as object id.");
          assert(object.name === name, "Object.name should be what we set.");
        }

        assert(saveResult.object instanceof type, "result object must be of correct type.");
        assert(saveResult.object.name === name, "saveResult object property must be what we set.");
      }

      /***********************************************************************/

      describe("insert: promises with pers", function(){

        it("pers.save() for insert using promises", function * (){
          let c = new pers.m.Customer();
          c.name = "Ege Madra";
          let saveResult = yield pers.save(c);
          checkInsertResult(saveResult, c, pers.m.Customer, "Ege Madra", "pers.save");
        });

        it("pers.insert() for insert using promises", function * (){
          let c = new pers.m.Customer();
          c.name = "John Doe";
          let saveResult = yield pers.insert(c);
          checkInsertResult(saveResult, c, pers.m.Customer, "John Doe", "pers.insert");
        });

        it("pers.saveAs() for insert using promises", function * (){
          var o = {name: "Ege Madra2"}
          let saveResult = yield pers.saveAs(o, "Customer");
          checkInsertResult(saveResult, o, pers.m.Customer, "Ege Madra2", "pers.saveAs");
        });

        it("pers.insertAs() for insert using promises", function * (){
          var o = {name: "John Doe2"}
          let saveResult = yield pers.insertAs(o, "Customer");
          checkInsertResult(saveResult, o, pers.m.Customer, "John Doe2", "pers.insertAs");
        });

      });

      describe("insert: promises with model", function(){

        it("object.save() for insert using promises", function * (){
          let c = new pers.m.Customer();
          c.name = "Ege Madra";
          let saveResult = yield c.save();
          checkInsertResult(saveResult, c, pers.m.Customer, "Ege Madra", "object.save");
        });

        it("object.insert() for insert using promises", function * (){
          let c = new pers.m.Customer();
          c.name = "John Doe";
          let saveResult = yield c.insert();
          checkInsertResult(saveResult, c, pers.m.Customer, "John Doe", "object.insert");
        });

        it("Model.save() for insert using promises", function * (){
          var o = {name: "Ege Madra2"}
          let saveResult = yield pers.models.Customer.save(o);
          checkInsertResult(saveResult, o, pers.m.Customer, "Ege Madra2", "Model.save");
        });

        it("Model.insert() for insert using promises", function * (){
          var o = {name: "John Doe2"}
          let saveResult = yield pers.models.Customer.insert(o);
          checkInsertResult(saveResult, o, pers.m.Customer, "John Doe2", "Model.insert");
        });

      });

      describe("insert: callbacks with pers", function() {

        it("pers.save() for insert using callbacks", function (done){
          let c = new pers.m.Customer();
          c.name = "Ege Madra";
          pers.save(c, function(err, saveResult){
            if (err) return done(err);
            checkInsertResult(saveResult, c, pers.m.Customer, "Ege Madra", "pers.save");
            done();
          });
        });

        it("pers.insert() for insert using callbacks", function (done){
          let c = new pers.m.Customer();
          c.name = "John Doe";
          pers.insert(c, function(err, saveResult){
            if (err) return done(err);
            checkInsertResult(saveResult, c, pers.m.Customer, "John Doe", "pers.insert");
            done();
          });
        });

        it("pers.saveAs() for insert using callbacks", function (done){
          var o = {name: "Ege Madra2"}
          pers.saveAs(o, "Customer", function(err, saveResult){
            if (err) return done(err);
            checkInsertResult(saveResult, o, pers.m.Customer, "Ege Madra2", "pers.saveAs");
            done();
          });
        });

        it("pers.insertAs() for insert using callbacks", function (done){
          var o = {name: "John Doe2"}
          pers.insertAs(o, "Customer", function(err, saveResult){
            if (err) return done(err);
            checkInsertResult(saveResult, o, pers.m.Customer, "John Doe2", "pers.insertAs");
            done();
          });
        });

      });

      describe("insert: callbacks with model", function(){

        it("object.save() for insert using callback", function (done){
          let c = new pers.m.Customer();
          c.name = "Ege Madra";
          c.save(function(err, saveResult){
            if (err) return done(err);
            checkInsertResult(saveResult, c, pers.m.Customer, "Ege Madra", "object.save");
            done();
          });
        });

        it("object.insert() for insert using callbacks", function (done){
          let c = new pers.m.Customer();
          c.name = "John Doe";
          c.insert(function(err, saveResult){
            if (err) return done(err);
            checkInsertResult(saveResult, c, pers.m.Customer, "John Doe", "object.insert");
            done();
          });
        });

        it("Model.save() for insert using callbacks", function (done){
          var o = {name: "Ege Madra2"}
          pers.models.Customer.save(o, function(err, saveResult){
            if (err) return done(err);
            checkInsertResult(saveResult, o, pers.m.Customer, "Ege Madra2", "Model.save");
            done();
          });
        });

        it("Model.insert() for insert using callbacks", function (done){
          var o = {name: "John Doe2"}
          pers.models.Customer.insert(o, function(err, saveResult){
            if (err) return done(err);
            checkInsertResult(saveResult, o, pers.m.Customer, "John Doe2", "Model.insert");
            done();
          });
        });

      });

      describe("Inserting into a non-auto-increment pk table", function(){

        it("Insert with promise", function * () {
          var o = pers.m.Country.cast({code: "USA", name: "United States of America"});
          var saveResult = yield o.insert();
          ["lastInsertId", "command", "status", "object"].forEach(field => {
            assert(field in saveResult, field + " must be a property in saveResult.");
          });
          assert(saveResult.command === "insert", "command must read insert.");
          assert(saveResult.status === "saved", "status must read saved.");
          assert(saveResult.object.code === o.code, "pk in the object must be updated.");
          assert(saveResult.object.name === o.name, "Object.name should be what we set.");
          assert(saveResult.object.code === "USA", "saveResult object code must read USA.");
          assert(saveResult.lastInsertId === "USA", "lastInsertId must read the code that we set.");
        });

        it("Insert with callback", function (done) {

          var o = pers.m.Country.cast({code: "GBR", name: "Great Britain"});
          o.insert(function(err, saveResult){
            assert(err == null, "No err should be present.");

            ["lastInsertId", "command", "status", "object"].forEach(field => {
              assert(field in saveResult, field + " must be a property in saveResult.");
            });
            assert(saveResult.command === "insert", "command must read insert.");
            assert(saveResult.status === "saved", "status must read saved.");
            assert(saveResult.object.code === o.code, "pk in the object must be updated.");
            assert(saveResult.object.name === o.name, "Object.name should be what we set.");
            assert(saveResult.object.code === "GBR", "saveResult object code must read GBR.");
            assert(saveResult.lastInsertId === "GBR", "lastInsertId must read the code that we set.");
            done();
          });
        });
      })

      describe("insertion errors", function (){

        it("Ensure inserts with existing ids throwing (promise)", function * (){
          try {
            yield pers.insertAs({"id": 1, name: "Ege"}, "Customer");
            assert(false, "Inserting with an existing id must throw.");
          }
          catch(err){
            assert(true);
          }
        });

        it("Ensure inserts with existing ids returns error (callback)", function (done){
          pers.insertAs({"id": 1, name: "Ege"}, "Customer", function(err, result){
            assert(err != null, "Inserting with an existing id must return error.");
            assert(result == null, "There must not be a result.");
            done();
          });
        });

        it("Inserts without pks to non-auto-increment tables must throw in promise mode", function * (){
          try {
            yield pers.insertAs({name: "Latvia"}, "Country");
            assert(false, "Inserting without a pk to a non auto-increment table must throw.");
          }
          catch(err){
            assert(true);
          }
        });

        it("Inserts without pks to non-auto-increment tables must error in callback mode", function (done){
          pers.insertAs({name: "Latvia"}, "Country", function(err, result){
            assert(err != null, "Inserting without a pk to a non auto-increment table must error.");
            assert(result == null, "There must not be a result.");
            done();
          });
        });

      });

      describe("Make sure we have 16 customers and 2 countries so far", function() {

        it("Get all customers, using repository with promises", function * (){
          var customers = yield pers.query().from("Customer").exec();
          assert(Array.isArray(customers), ".query() returns an array.");
          assert(customers.length === 16, "we must have inserted 16 customers.");
        });

        it("Get all customers, using model with promises", function * (){
          var customers = yield pers.models.Customer.query().exec();
          assert(Array.isArray(customers), ".query() returns an array.");
          assert(customers.length === 16, "we must have inserted 16 customers.");
        });

        it("Get all countries, using repository with callbacks", function (done){
            pers.query().from("Country").exec(function(err, countries){
            assert(err == null, "No errors.");
            if (err) done();
            assert(Array.isArray(countries), ".query() returns an array.");
            assert(countries.length === 2, "we must have inserted 2 countries.");
            done();
          });
        });

        it("Get all countries, using model with callbacks", function (done){
            pers.models.Country.query().exec(function(err, countries){
            assert(err == null, "No errors.");
            if (err) done();
            assert(Array.isArray(countries), ".query() returns an array.");
            assert(countries.length === 2, "we must have inserted 2 countries.");
            done();
          });
        });
      });

      describe("Make sure basic queries don't throw in callback mode", function () {

        it("bad queries with callbacks can't throw", function (done){

          var errCount = 0, resultCount = 0;
          function cb (err, results) {
            if (err != null) errCount ++;
            if (results != null) resultCount ++;
          };

          var Customer = pers.models.Customer;

          pers.models.Country.query().select("nonexistentColumn").exec(cb); //1
          Customer.insert({}, cb); //2
          Customer.save({}, cb); //3
          var c = new Customer();
          c.save(cb); //4
          c.insert(cb); //5
          pers.save(new Customer(), cb); //6
          pers.saveAs({}, "Customer", cb); //7
          pers.insert(new Customer(), cb); //8
          pers.insertAs({}, "Customer", cb); //9
          pers.models.Country.query().select("nonexistentColumn").one(cb); //10

          setTimeout(function(){
            assert(errCount === 10, "We must have collected 10 errors by now.");
            assert(resultCount === 0, "We must have collected no results by now.");
            done();
          },50);
        });
      });

      describe("Updates", function  () {

        var c1 = null;
        function * getCustomer1 () {
          return c1 = yield pers.q().f("Customer").one();
        }

        it("pers.save()", function * () {
          yield getCustomer1();
          c1.name = "Darth Vader";
          var saveResult = yield pers.save(c1);
          ["lastInsertId", "command", "status", "object"].forEach(field => {
            assert(field in saveResult, field + " must be a property in saveResult.");
          });
          assert(saveResult.command === "update", "command must read update.");
          assert(saveResult.status === "saved", "status must read saved.");
          assert(saveResult.object.name === "Darth Vader", "Saved object should reflect the new value.")
          assert(saveResult.object === c1, "There is only one object!");
        });

        it("object.save()", function * () {
          assert(c1.name === "Darth Vader", "It must be modified now.");
          c1.name = "Princess Lea";
          var saveResult = yield c1.save();
          ["lastInsertId", "command", "status", "object"].forEach(field => {
            assert(field in saveResult, field + " must be a property in saveResult.");
          });
          assert(saveResult.command === "update", "command must read update.");
          assert(saveResult.status === "saved", "status must read saved.");
          assert(saveResult.object.name === "Princess Lea", "Saved object should reflect the new value.")
          assert(saveResult.object === c1, "There is only one object!");
        });

        it("pers.saveAs()", function * () {
          assert(c1.name === "Princess Lea", "It must be modified now.");
          var newObject = {id: c1.id, name: "Luke Skywalker"};
          var saveResult = yield pers.saveAs(newObject, "Customer");
          ["lastInsertId", "command", "status", "object"].forEach(field => {
            assert(field in saveResult, field + " must be a property in saveResult.");
          });
          assert(saveResult.command === "update", "command must read update.");
          assert(saveResult.status === "saved", "status must read saved.");
          assert(saveResult.object.name === "Luke Skywalker", "Saved object should reflect the new value.")
          assert(saveResult.object.id === c1.id, "Although 2 different objects, ids must be the same.");
        });

        it("Model.save()", function * () {
          assert(c1.name === "Princess Lea", "Previous save as should not have touched the original object");
          var newObject = {id: c1.id, name: "Han Solo"};
          var saveResult = yield pers.models.Customer.save(newObject);
          ["lastInsertId", "command", "status", "object"].forEach(field => {
            assert(field in saveResult, field + " must be a property in saveResult.");
          });
          assert(saveResult.command === "update", "command must read update.");
          assert(saveResult.status === "saved", "status must read saved.");
          assert(saveResult.object.name === "Han Solo", "Saved object should reflect the new value.")
          assert(saveResult.object.id === c1.id, "Although 2 different objects, ids must be the same.");
          //now validate:
          var finalCustomer = yield pers.loadById("Customer", c1.id);
          assert(finalCustomer.id === c1.id && finalCustomer.name === "Han Solo", "Just validate.");
        });

        it("Not update anything", function * () {
          const fakeId = 98564;
          var saveResult = yield pers.saveAs({id: fakeId, name: "Avarel Dalton"}, "Customer");
          ["lastInsertId", "command", "status", "object"].forEach(field => {
            assert(field in saveResult, field + " must be a property in saveResult.");
          });
          assert(saveResult.command === "update", "command must read update.");
          assert(saveResult.status === "not-saved", "status must read not-saved.");
          //validate not saved:
          var nullCustomer = yield pers.m.Customer.loadById(fakeId);
          assert(nullCustomer === null, "There should be no customer with that id.");
        });

      });

      describe("deletes: pers.deleteById & pers.deleteObject", function() {

        it("pers.deleteById with promises", function * (){
          var deleteResult = yield pers.deleteById("Customer", 1);
          checkDeleteResult(deleteResult, null, pers.models.Customer, 1, "pers.deleteById");
        });

        it("pers.deleteById with callbacks", function (done){
          pers.deleteById("Customer", 2, function(err, deleteResult){
            if (err) return done(err);
            checkDeleteResult(deleteResult, null, pers.models.Customer, 2, "pers.deleteById");
            done();
          });
        });

        it("pers.deleteObject with promises", function * () {
          var c = pers.cast({id: 3}, "Customer");
          var deleteResult = yield pers.deleteObject(c);
          checkDeleteResult(deleteResult, c, pers.models.Customer, 3, "pers.deleteObject");
        });

        it("pers.deleteObject with callbacks", function (done){
          var c = pers.cast({id: 4}, "Customer");
          pers.deleteObject(c, function(err, deleteResult){
            if (err) return done(err);
            checkDeleteResult(deleteResult, c, pers.models.Customer, 4, "pers.deleteObject");
            done();
          });
        });
      });

      describe("deletes: Model.deleteById & object.delete", function() {

        it("Model.deleteById with promises", function * (){
          var deleteResult = yield pers.models.Customer.deleteById(5);
          checkDeleteResult(deleteResult, null, pers.models.Customer, 5, "Model.deleteById");
        });

        it("Model.deleteById with callbacks", function (done){
          pers.models.Customer.deleteById(6, function(err, deleteResult){
            if (err) return done(err);
            checkDeleteResult(deleteResult, null, pers.models.Customer, 6, "Model.deleteById");
            done();
          });
        });

        it("object.delete with promises", function * () {
          var c = pers.cast({id: 7}, "Customer");
          var deleteResult = yield c.delete();
          checkDeleteResult(deleteResult, c, pers.models.Customer, 7, "object.delete");
        });

        it("object.delete with callbacks", function (done){
          var c = pers.cast({id: 8}, "Customer");
          c.delete(function(err, deleteResult){
            if (err) return done(err);
            checkDeleteResult(deleteResult, c, pers.models.Customer, 8, "object.delete");
            done();
          });
        });
      });

      describe("not-deleted and validation", function () {

        it("Not delete anything", function * () {
          const id = 1; //we have already deleted Customer:1 above.
          var deleteResult = yield pers.deleteById("Customer", 1);
          ["command", "status", "object"].forEach(field => {
            assert(field in deleteResult, field + " must be a property in deleteResult.");
          });
          assert(deleteResult.command === "delete", "command must read delete.");
          assert(deleteResult.status === "not-deleted", "status must read not-deleted.");
        });

        it("Validate deletes by confirming we have only 8 customers left", function * (){
          var customers = yield pers.models.Customer.q().exec();
          assert(customers.length === 8, "We should have 8 customers now.");
        });
      });

      describe("hydrate()", function() {

        let saveResult = null, customer = null;

        function * prepare () {
          saveResult = yield pers.insertAs({name: "James Bond"}, "Customer");
          customer = yield pers.loadById("Customer", saveResult.lastInsertId, "id");
          assert(customer.id === saveResult.lastInsertId, "customer id must be the same as inserted.");
          assert(customer.name === undefined, "We didn't select name field.");
        }

        it("pers.hydrate() with promises", function * () {
          yield prepare();
          let newCustomer = yield pers.hydrate(customer);
          assert(customer === newCustomer, "They are the same objects.");
          assert(customer.name === "James Bond", "original customer is modified must have the name 'James Bond'.");
        });

        it("object.hydrate() with promises", function * () {
          delete customer.name;
          let newCustomer = yield customer.hydrate("name");
          assert(customer === newCustomer, "They are the same objects.");
          assert(customer.name === "James Bond", "original customer is modified must have the name 'James Bond'.");
        });

        it("pers.hydrate() with callbacks", function (done) {
          delete customer.name;
          pers.hydrate(customer, "name", function(err, newCustomer){
            if (err) return done(err);
            assert(customer === newCustomer, "They are the same objects.");
            assert(customer.name === "James Bond", "original customer is modified must have the name 'James Bond'.");
            done();
          });
        });

        it("object.hydrate() with callbacks", function (done) {
          delete customer.name;
          customer.hydrate("name", function(err, newCustomer){
            if (err) return done(err);
            assert(customer === newCustomer, "They are the same objects.");
            assert(customer.name === "James Bond", "original customer is modified must have the name 'James Bond'.");
            done();
          });
        });

        it("hydrate without pk throws (promises)", function * () {
          var c = new pers.models.Customer();
          try {
            yield c.hydrate("name");
            assert(false, "cannot end up here.");
          } catch (err) {
            assert(err.toString().includes("without the primary key"), "Should tell about the missing pk.");
          }
        });

        it("hydrate without a corresponding row in db throws (promises)", function * () {
          var c = pers.cast({id: 2657}, "Customer");
          try {
            yield c.hydrate("name");
          } catch (err) {
            assert(err.toString().includes("not found in the database"), "Should tell about the missing row.");
          }
        });

        it("hydrate without pk errors (callbacks)", function (done) {
          var c = new pers.models.Customer();
          c.hydrate("name", function(err, result){
            assert(err.toString().includes("without the primary key"), "Should tell about the missing pk.");
            done();
          });
        });

        it("hydrate without a corresponding row in db errors (callbacks)", function (done) {
          var c = pers.cast({id: 2657}, "Customer");
          c.hydrate("name", function(err, result){
            assert(err.toString().includes("not found in the database"), "Should tell about the missing row.");
            done();
          });
        });

      });

    });

  }
});
