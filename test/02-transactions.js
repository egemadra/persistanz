"use strict";
var prepare = require("./attic/prepare.js");
var conf = prepare.loadConfig();
var Persistanz = require("../lib/Persistanz.js");
var assert = require("chai").assert;
require('co-mocha');

describe("Same CRUD tests with transactions", function(done) {

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
          let tx = yield pers.getTransaction();
          let saveResult = yield pers.saveX(tx, c);
          checkInsertResult(saveResult, c, pers.m.Customer, "Ege Madra", "pers.save");
          yield tx.commit();
        });

        it("pers.insert() for insert using promises", function * (){
          let c = new pers.m.Customer();
          c.name = "John Doe";
          let tx = yield pers.getTransaction();
          let saveResult = yield pers.insertX(tx, c);
          checkInsertResult(saveResult, c, pers.m.Customer, "John Doe", "pers.insert");
          yield tx.commit();
        });

        it("pers.saveAs() for insert using promises", function * (){
          var o = {name: "Ege Madra2"};
          let tx = yield pers.getTransaction();
          let saveResult = yield pers.saveAsX(tx, o, "Customer");
          checkInsertResult(saveResult, o, pers.m.Customer, "Ege Madra2", "pers.saveAs");
          yield tx.commit();
        });

        it("pers.insertAs() for insert using promises", function * (){
          var o = {name: "John Doe2"};
          let tx = yield pers.getTransaction();
          let saveResult = yield pers.insertAsX(tx, o, "Customer");
          checkInsertResult(saveResult, o, pers.m.Customer, "John Doe2", "pers.insertAs");
          yield tx.commit();
        });

      });

      describe("insert: promises with model", function(){

        it("object.save() for insert using promises", function * (){
          let c = new pers.m.Customer();
          c.name = "Ege Madra";
          let tx = yield pers.getTransaction();
          let saveResult = yield c.saveX(tx);
          checkInsertResult(saveResult, c, pers.m.Customer, "Ege Madra", "object.save");
          yield tx.commit();
        });

        it("object.insert() for insert using promises", function * (){
          let c = new pers.m.Customer();
          c.name = "John Doe";
          let tx = yield pers.getTransaction();
          let saveResult = yield c.insertX(tx);
          checkInsertResult(saveResult, c, pers.m.Customer, "John Doe", "object.insert");
          yield tx.commit();
        });

        it("Model.save() for insert using promises", function * (){
          var o = {name: "Ege Madra2"}
          let tx = yield pers.getTransaction();
          let saveResult = yield pers.models.Customer.saveX(tx, o);
          checkInsertResult(saveResult, o, pers.m.Customer, "Ege Madra2", "Model.save");
          yield tx.commit();
        });

        it("Model.insert() for insert using promises", function * (){
          var o = {name: "John Doe2"}
          let tx = yield pers.getTransaction();
          let saveResult = yield pers.models.Customer.insertX(tx, o);
          checkInsertResult(saveResult, o, pers.m.Customer, "John Doe2", "Model.insert");
          yield tx.commit();
        });

      });

      describe("insert: callbacks with pers", function() {

        it("pers.save() for insert using callbacks", function (done){
          let c = new pers.m.Customer();
          c.name = "Ege Madra";
          pers.getTransaction(null, function(err, tx){
            if (err) return done(err);
            pers.saveX(tx, c, function(err, saveResult){
              if (err) return done(err);
              checkInsertResult(saveResult, c, pers.m.Customer, "Ege Madra", "pers.save");
              tx.commit(function(err, result){
                return done(err);
              });
            });
          });
        });

        it("pers.insert() for insert using callbacks", function (done){
          let c = new pers.m.Customer();
          c.name = "John Doe";
          pers.getTransaction(null, function(err, tx){
            if (err) return done(err);
            pers.insertX(tx, c, function(err, saveResult){
              if (err) return done(err);
              checkInsertResult(saveResult, c, pers.m.Customer, "John Doe", "pers.insert");
              tx.commit(function(err, result){
                done(err);
              });
            });
          });

        });

        it("pers.saveAs() for insert using callbacks", function (done){
          var o = {name: "Ege Madra2"};
          pers.getTransaction(null, function(err, tx){
            if (err) return done(err);
            pers.saveAsX(tx, o, "Customer", function(err, saveResult){
              if (err) return done(err);
              checkInsertResult(saveResult, o, pers.m.Customer, "Ege Madra2", "pers.saveAs");
              tx.commit(function(err, result){
                done(err);
              });
            });
          });
        });

        it("pers.insertAs() for insert using callbacks", function (done){
          var o = {name: "John Doe2"};
          pers.getTransaction(null, function(err, tx){
            if (err) return done(err);
            pers.insertAsX(tx, o, "Customer", function(err, saveResult){
              if (err) return done(err);
              checkInsertResult(saveResult, o, pers.m.Customer, "John Doe2", "pers.insertAs");
              tx.commit(function(err, result){
                done(err);
              });
            });
          });
        });
      });

      describe("insert: callbacks with model", function(){

        it("object.save() for insert using callback", function (done){
          let c = new pers.m.Customer();
          c.name = "Ege Madra";
          pers.getTransaction(null, function(err, tx){
            if (err) return done(err);
            c.saveX(tx, function(err, saveResult){
              if (err) return done(err);
              checkInsertResult(saveResult, c, pers.m.Customer, "Ege Madra", "object.save");
              tx.commit(function(err, result){
                done(err);
              });
            });
          });
        });

        it("object.insert() for insert using callbacks", function (done){
          let c = new pers.m.Customer();
          c.name = "John Doe";
          pers.getTransaction(null, function(err, tx){
            if (err) return done(err);
            c.insertX(tx, function(err, saveResult){
              if (err) return done(err);
              checkInsertResult(saveResult, c, pers.m.Customer, "John Doe", "object.insert");
              tx.commit(function(err, result){
                done(err);
              });
            });
          });
        });

        it("Model.save() for insert using callbacks", function (done){
          var o = {name: "Ege Madra2"};
          pers.getTransaction(null, function(err, tx){
            if (err) return done(err);
            pers.models.Customer.saveX(tx, o, function(err, saveResult){
              if (err) return done(err);
              checkInsertResult(saveResult, o, pers.m.Customer, "Ege Madra2", "Model.save");
              tx.commit(function(err, result){
                done(err);
              });
            });
          });
        });

        it("Model.insert() for insert using callbacks", function (done){
          var o = {name: "John Doe2"};
          pers.getTransaction(null, function(err, tx){
            if (err) return done(err);
            pers.models.Customer.insertX(tx, o, function(err, saveResult){
              if (err) return done(err);
              checkInsertResult(saveResult, o, pers.m.Customer, "John Doe2", "Model.insert");
              tx.commit(function(err, result){
                done(err);
              });
            });
          });
        });

      });

      describe("insertion errors", function (){

        it("Ensure inserts with existing ids throwing (promise)", function * (){
          try {
            let tx = yield pers.getTransaction();
            yield pers.insertAsX(tx, {"id": 1, name: "Ege"}, "Customer");
            assert(false, "Inserting with an existing id must throw.");
          }
          catch(err){ //automatic rollback must occur.
            assert(true);
          }
        });

        it("Ensure inserts with existing ids returns error (callback)", function (done){
          pers.getTransaction(null, function(err, tx){
            if (err) return done(err);
            pers.insertAsX(tx, {"id": 1, name: "Ege"}, "Customer", function(err, result){
              assert(err != null, "Inserting with an existing id must return error.");
              assert(result == null, "There must not be a result.");
              done();
            });
          })
        });

        it("Inserts without pks to non-auto-increment tables must throw in promise mode", function * (){
          let tx = yield pers.getTransaction();
          try {
            yield pers.insertAsX(tx, {name: "Latvia"}, "Country");
            assert(false, "Inserting without a pk to a non auto-increment table must throw.");
          }
          catch(err){
            assert(true);
          }
        });

        it("Inserts without pks to non-auto-increment tables must error in callback mode", function (done){
          pers.getTransaction(null, function(err, tx){
            if (err) return done(err);
            pers.insertAsX(tx, {name: "Latvia"}, "Country", function(err, result){
              assert(err != null, "Inserting without a pk to a non auto-increment table must error.");
              assert(result == null, "There must not be a result.");
              done();
            });
          });
        });
      });
      /***********************************************************************/
      describe("Make sure we have 16 customers.", function() {

        it("Get all customers, using repository with promises", function * (){
          let tx = yield pers.getTransaction();
          let customers = yield pers.query(tx).from("Customer").exec();
          tx.commit();
          assert(Array.isArray(customers), ".query() returns an array.");
          assert(customers.length === 16, "we must have inserted 16 customers.");
        });

        it("Get all customers, using model with promises", function * (){
          let tx = yield pers.getTransaction();
          var customers = yield pers.models.Customer.query(tx).exec();
          tx.commit();
          assert(Array.isArray(customers), ".query() returns an array.");
          assert(customers.length === 16, "we must have inserted 16 customers.");
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

          pers.getTransaction(null, (err, tx) => pers.models.Country.query(tx).select("nonexistentColumn").exec(cb) ); //1
          pers.getTransaction(null, (err, tx) => Customer.insertX(tx, {}, cb) ); //2
          pers.getTransaction(null, (err, tx) => Customer.saveX(tx, {}, cb) ); //3
          var c = new Customer();
          pers.getTransaction(null, (err, tx) => c.saveX(tx, cb) ); //4
          pers.getTransaction(null, (err, tx) => c.insertX(tx, cb) ); //5
          pers.getTransaction(null, (err, tx) => pers.saveX(tx, new Customer(), cb) ); //6
          pers.getTransaction(null, (err, tx) => pers.saveAsX(tx, {}, "Customer", cb) ); //7
          pers.getTransaction(null, (err, tx) => pers.insertX(tx, new Customer(), cb) ); //8
          pers.getTransaction(null, (err, tx) => pers.insertAsX(tx, {}, "Customer", cb) ); //9
          pers.getTransaction(null, (err, tx) => pers.models.Country.query(tx).select("nonexistentColumn").one(cb) ); //10

          setTimeout(function(){
            assert(errCount === 10, "We must have collected 10 errors by now.");
            assert(resultCount === 0, "We must have collected no results by now.");
            done();
          },50);
        });
      });

      describe("Updates", function  () {

        var c1 = null;
        var tx = null;
        function * getCustomer1 () {
          tx = yield pers.getTransaction();
          return c1 = yield pers.q().f("Customer").one();
        }

        it("pers.save()", function * () {
          yield getCustomer1();
          c1.name = "Darth Vader";
          var saveResult = yield pers.saveX(tx, c1);
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
          var saveResult = yield c1.saveX(tx);
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
          var saveResult = yield pers.saveAsX(tx, newObject, "Customer");
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
          var saveResult = yield pers.models.Customer.saveX(tx, newObject);
          ["lastInsertId", "command", "status", "object"].forEach(field => {
            assert(field in saveResult, field + " must be a property in saveResult.");
          });
          assert(saveResult.command === "update", "command must read update.");
          assert(saveResult.status === "saved", "status must read saved.");
          assert(saveResult.object.name === "Han Solo", "Saved object should reflect the new value.")
          assert(saveResult.object.id === c1.id, "Although 2 different objects, ids must be the same.");
          //now validate:
          var finalCustomer = yield pers.loadByIdX(tx, "Customer", c1.id);
          assert(finalCustomer.id === c1.id && finalCustomer.name === "Han Solo", "Just validate.");
        });

        it("Not update anything", function * () {
          const fakeId = 98564;
          var saveResult = yield pers.saveAsX(tx, {id: fakeId, name: "Avarel Dalton"}, "Customer");
          ["lastInsertId", "command", "status", "object"].forEach(field => {
            assert(field in saveResult, field + " must be a property in saveResult.");
          });
          assert(saveResult.command === "update", "command must read update.");
          assert(saveResult.status === "not-saved", "status must read not-saved.");
          //validate not saved:
          var nullCustomer = yield pers.m.Customer.loadByIdX(tx, fakeId);
          assert(nullCustomer === null, "There should be no customer with that id.");
        });

        it("Commit and check in callback", function (done) {
          tx.commit(function(err, res){
            if (err) return done(err);
            pers.loadById("Customer", c1.id, "*", function(err, finalCustomer){
              if (err) return done(err);
              assert(finalCustomer.name === "Han Solo", "After-commit name must be the same.");
              done();
            });
          });
        });

      });

      //These tests are to satisfy some coverage. Assertations are unimportant
      //but postgres should not stall at the end.
      describe("Cast error and transactions.", function() {

        it("Cast error in callback", function (done) {
          pers.getTransaction(null, function(err, tx){
            pers.saveAsX(tx, {}, "NONEXISTANT_MODEL", function(err){
              assert(err != null, "err can't be null");
              done();
            })
          });
        });

        it("Cast error in promise", function * () {
          var tx = yield pers.getTransaction();
          try{
            yield pers.saveAsX(tx, {}, "NONEXISTANT_MODEL");
            assert(false, "should not end up here.");
          } catch (err) {
            assert(err != null, "err can't be null");
          }
        });

      });

      describe("deletes: pers.deleteById & pers.deleteObject", function() {

        it("pers.deleteById with promises", function * (){
          let tx = yield pers.getTransaction();
          var deleteResult = yield pers.deleteByIdX(tx, "Customer", 1);
          checkDeleteResult(deleteResult, null, pers.models.Customer, 1, "pers.deleteById");
          yield tx.commit();
        });

        it("pers.deleteById with callbacks", function (done){
          pers.getTransaction(null, function(err, tx){
            pers.deleteByIdX(tx, "Customer", 2, function(err, deleteResult){
              if (err) return done(err);
              checkDeleteResult(deleteResult, null, pers.models.Customer, 2, "pers.deleteById");
              tx.commit(function(err, result){
                if (err) return done(err);
                done();
              });
            });
          });
        });

        it("pers.deleteObject with promises", function * () {
          let tx = yield pers.getTransaction();
          var c = pers.cast({id: 3}, "Customer");
          var deleteResult = yield pers.deleteObjectX(tx, c);
          checkDeleteResult(deleteResult, c, pers.models.Customer, 3, "pers.deleteObject");
          yield tx.commit();
        });

        it("pers.deleteObject with callbacks", function (done){
          var c = pers.cast({id: 4}, "Customer");
          pers.getTransaction(null, function(err, tx){
            pers.deleteObjectX(tx, c, function(err, deleteResult){
              if (err) return done(err);
              checkDeleteResult(deleteResult, c, pers.models.Customer, 4, "pers.deleteObject");
              tx.commit(function(err, result){
                if (err) return done(err);
                done();
              });
            });
          });
        });
      });

      describe("deletes: Model.deleteById & object.delete", function() {

        it("Model.deleteById with promises", function * (){
          let tx = yield pers.getTransaction();
          var deleteResult = yield pers.models.Customer.deleteByIdX(tx, 5);
          checkDeleteResult(deleteResult, null, pers.models.Customer, 5, "Model.deleteById");
          yield tx.commit();
        });

        it("Model.deleteById with callbacks", function (done){
          pers.getTransaction(null, function(err, tx){
            pers.models.Customer.deleteByIdX(tx, 6, function(err, deleteResult){
              if (err) return done(err);
              checkDeleteResult(deleteResult, null, pers.models.Customer, 6, "Model.deleteById");
              tx.commit(function(err, result){
                if (err) return done(err);
                done();
              });
            });
          });
        });

        it("object.delete with promises", function * () {
          var c = pers.cast({id: 7}, "Customer");
          let tx = yield pers.getTransaction();
          var deleteResult = yield c.deleteX(tx);
          checkDeleteResult(deleteResult, c, pers.models.Customer, 7, "object.delete");
          yield tx.commit();
        });

        it("object.delete with callbacks", function (done){
          var c = pers.cast({id: 8}, "Customer");
          pers.getTransaction(null, function(err, tx){
            c.deleteX(tx, function(err, deleteResult){
              if (err) return done(err);
              checkDeleteResult(deleteResult, c, pers.models.Customer, 8, "object.delete");
              tx.commit(function(err, result){
                done();
              });
            });
          })
        });
      });

      describe("not-deleted and validation", function () {

        it("Not delete anything", function * () {
          const id = 1; //we have already deleted Customer:1 above.
          let tx = yield pers.getTransaction();
          var deleteResult = yield pers.deleteByIdX(tx, "Customer", 1);
          ["command", "status", "object"].forEach(field => {
            assert(field in deleteResult, field + " must be a property in deleteResult.");
          });
          assert(deleteResult.command === "delete", "command must read delete.");
          assert(deleteResult.status === "not-deleted", "status must read not-deleted.");
          yield tx.commit();
        });

        it("Validate deletes by confirming we have only 8 customers left", function * (){
          var customers = yield pers.models.Customer.q().exec();
          assert(customers.length === 8, "We should have 8 customers now.");
        });

      });

      describe("tx rollback and closed", function () {

        it("rollback with promises", function * (){
          const id = 9988; const name = "no name";
          var tx = yield pers.getTransaction();
          yield pers.insertAsX(tx, {name, id}, "Customer");
          var c = yield pers.loadByIdX(tx, "Customer", id);
          assert(c.id === id && c.name === name);
          yield tx.rollback();
          c = yield pers.loadById("Customer", id);
          assert(c === null, "There can't be a such customer.");
          try {
            yield tx.rollback();
            assert("Should not have come here.");
          } catch (err) {
            assert(err.toString().includes("Transaction is closed"), "We should have tx closed error.");
          }
        });

        it("rollback with callbacks", function (done){
          const id = 9988; const name = "no name";
          pers.getTransaction(null, function(err, tx){
            pers.insertAsX(tx, {name, id}, "Customer", function(err, saveResult){
              tx.rollback(function(err){
                pers.loadById("Customer", id, "*", function(err, customer){
                  assert(customer === null, "No such customer.");
                  tx.rollback(function(err){
                    assert(err.toString().includes("Transaction is closed"), "We should have tx closed error.");
                    return done();
                  });
                });
              });
            });
          });
        });

      });

      describe("hydrateX()", function() {

        let saveResult = null, customer = null, tx = null;

        function * prepare () {
          tx = yield pers.getTransaction();
          saveResult = yield pers.insertAsX(tx, {name: "James Bond"}, "Customer");
          customer = yield pers.loadByIdX(tx, "Customer", saveResult.lastInsertId, "id");
          assert(customer.id === saveResult.lastInsertId, "customer id must be the same as inserted.");
          assert(customer.name === undefined, "We didn't select name field.");
        }

        it("pers.hydrateX() with promises", function * () {
          yield prepare();
          let newCustomer = yield pers.hydrateX(tx, customer);
          assert(customer === newCustomer, "They are the same objects.");
          assert(customer.name === "James Bond", "original customer is modified must have the name 'James Bond'.");
        });

        it("object.hydrateX() with promises", function * () {
          delete customer.name;
          let newCustomer = yield customer.hydrateX(tx, "name");
          assert(customer === newCustomer, "They are the same objects.");
          assert(customer.name === "James Bond", "original customer is modified must have the name 'James Bond'.");
        });

        it("pers.hydrateX() with callbacks", function (done) {
          delete customer.name;
          pers.hydrateX(tx, customer, "name", function(err, newCustomer){
            if (err) return done(err);
            assert(customer === newCustomer, "They are the same objects.");
            assert(customer.name === "James Bond", "original customer is modified must have the name 'James Bond'.");
            done();
          });
        });

        it("object.hydrateX() with callbacks", function (done) {
          delete customer.name;
          customer.hydrateX(tx, "name", function(err, newCustomer){
            if (err) return done(err);
            assert(customer === newCustomer, "They are the same objects.");
            assert(customer.name === "James Bond", "original customer is modified must have the name 'James Bond'.");
            tx.commit(function(err, result){
              done();
            });
          });
        });

        it("hydrate without pk throws (promises)", function * () {
          var c = new pers.models.Customer();
          try {
            let tx = yield pers.getTransaction();
            yield c.hydrateX(tx, "name");
            assert(false, "cannot end up here.");
          } catch (err) {
            assert(err.toString().includes("without the primary key"), "Should tell about the missing pk.");
          }
        });

        it("hydrate without a corresponding row in db throws (promises)", function * () {
          var c = pers.cast({id: 2657}, "Customer");
          try {
            let tx = yield pers.getTransaction();
            yield c.hydrateX(tx, "name");
          } catch (err) {
            assert(err.toString().includes("not found in the database"), "Should tell about the missing row.");
          }
        });

        it("hydrate without pk errors (callbacks)", function (done) {
          var c = new pers.models.Customer();
          pers.getTransaction(null, function(err, tx){
            c.hydrateX(tx, "name", function(err, result){
              assert(err.toString().includes("without the primary key"), "Should tell about the missing pk.");
              done();
            });
          });
        });

        it("hydrate without a corresponding row in db errors (callbacks)", function (done) {
          var c = pers.cast({id: 2657}, "Customer");
          pers.getTransaction(null, function(err, tx){
            c.hydrateX(tx, "name", function(err, result){
              assert(err.toString().includes("not found in the database"), "Should tell about the missing row.");
              done();
            });
          });
        });
      });

      describe("missing tx errors", function () {

        it("all missing tx errors", function * (){
          var throwers = [
            pers.loadByIdX("hey"),
            pers.hydrateX("pey"),
            pers.insertX("huy"),
            pers.insertAsX("huy"),
            pers.saveX("huy"),
            pers.saveAsX("huy"),
            pers.deleteByIdX("huy"),
            pers.deleteObjectX("huy"),
          ];

          for (var t of throwers) {
            try {
              yield t;
              assert(false, "Cannot end up here.");
            } catch (err) {
              assert(err.message.indexOf('No transaction object supplied') > -1, "Err should have descriptive info.");
            }
          }
        });

      });

    });

  }
});
