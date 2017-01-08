"use strict";
var prepare = require("./attic/prepare.js");
var conf = prepare.loadConfig();
var Persistanz = require("../lib/Persistanz.js");
var assert = require("chai").assert;
require('co-mocha');

describe("Configuration and hooks", function(done) {

  for (var adapterName of conf.applyTestsTo) {

    describe("running for " + adapterName, function() {

      let pers, dbConf;

      (function(adapterName){
        before("Set up databases and initialize persistanz : " + adapterName , function *  () {
          dbConf = conf.dbConfigs[adapterName];
          dbConf.adapter = adapterName;
          yield prepare.createTestDatabase(dbConf);
        });
      })(adapterName);

      after("Destroy persistanz instance", function * destroy () {
        try { //don't throw if pers.create() didn't succeed.
          yield pers.destroy();
        }
        catch(err){};
      });

      describe("Basic config options", function(){
        class MyBaseModel {
          constructor() { this.created = "Yes, created." }
          getCreated() { return this.created; }
          static doSomething() {}
        }

        class Customer {
          static isCustomDefined () { return true; }
        }

        class Order {}

        let options = {
          baseModel: MyBaseModel,
          models: [
            Order,
            {
              model: Customer,
              extend: false,
            },
            {
              model: "OrderItem",
              extend: false,
            },
            {
              model: "RenamedOrderItem",
              table: "OrderItem"
            }
          ]
        }

        it("Base model extention", function * () {
          pers = new Persistanz(dbConf, options);
          var result = yield pers.create();
          assert(result === true, "Create should succeed and must return true.");

          const Product = pers.models.Product;
          assert(Product.prototype instanceof MyBaseModel, "auto-generated classes must inherit the baseModel.");
          assert("getCreated" in Product.prototype &&
            typeof Product.prototype.getCreated === "function", "Just to make sure.");
          assert("doSomething" in Product && typeof Product.doSomething === 'function', "Make doubly sure.");
          //check instance:
          var p = new Product();
          assert(p instanceof Product, "Make sure inheritance didn't go wrong and objects are instances of their own classes");
          assert(p instanceof MyBaseModel, "Make sure inheritance didn't go wrong and objects are instances of the base class.");
          assert(p.constructor.name === "Product", "Triply sure...");
          assert("created" in p, "instance properties must be present in extended class object.");
          assert(p.created === 'Yes, created.', "extented class must have called parent constructor.");
          assert(p.getCreated() === p.created, "Nothing to prove here.");
          assert("save" in p, "default methods must exist in instances.");
          assert("save" in Product, "default static methods must exist in classes.");
        });

        it("Base model not extention & undecorated custom models with extend = false", function * () {
          assert(! (Customer.prototype instanceof MyBaseModel), "user-defined classes must not inherit the baseModel.");
          assert(! (Order.prototype instanceof MyBaseModel), "user-defined classes must not inherit the baseModel (2).");
          assert("isCustomDefined" in Customer && Customer.isCustomDefined() === true
            , "Persistanz should not overwrite user-defined models.");
          //user-defined model with extend = true:
          const o = new Order();
          assert("save" in o, "default methods must exist in instances of user-defined models.");
          assert("save" in Order, "default static methods must exist in classes of user-defined models.");
          //user-defined model with extend = false:
          const c = new Customer();
          assert(! ("save" in c), "default methods must NOT exist in instances of user-defined models with extend = false option.");
          assert(! ("save" in Customer), "default static methods must NOT exist in classes of user-defined models with extend = false option.");
          const oi = new pers.m.OrderItem();
          assert(! ("save" in oi), "default methods must NOT exist in instances of user-defined models with extend = false option.");
          assert(! ("save" in pers.m.OrderItem), "default static methods must NOT exist in classes of user-defined models with extend = false option.");
          //user-defined models with extend = false can still be used in persistanz:
          c.name = "R2D2";
          yield pers.save(c);
          const loadedCustomer = yield pers.q().f("Customer").one();
          assert(loadedCustomer.name === c.name, "methods on persistanz should function on user-defined models with extend = false.");
        });

        it("Multiple models for the same table", function * () {
          assert("RenamedOrderItem" in pers.models, "Multiple models mapping to one table should be okay.");
          const roi = new pers.models.RenamedOrderItem();
          assert("save" in roi, "default methods must exist in instances of auto-generated models.");
          assert("save" in pers.m.RenamedOrderItem, "default static methods must exist in classes of auto-generated models.");
          yield pers.destroy();
        });
      });

      describe("model hooks with promises", function () {
        const hookCalls = {
          beforeSave: 0, afterSave: 0, beforeDelete: 0, afterDelete: 0, afterLoad: 0,
        }

        class Order {
          beforeSave(tx, command) {
            hookCalls.beforeSave ++;
            if (this.customerId == null) return Promise.resolve(false);
            this.dateTime = new Date();
            return Promise.resolve(true);
          }

          afterSave(tx, command) {
            hookCalls.afterSave ++;
            return Promise.resolve();
          }

          beforeDelete(tx) {
            hookCalls.beforeDelete ++;
            if (this.customerId == null) return Promise.resolve(false);
            return Promise.resolve(true);
          }

          afterDelete(tx) {
            hookCalls.afterDelete ++;
            return Promise.resolve();
          }

          afterLoad(tx) {
            hookCalls.afterLoad ++;
            return Promise.resolve();
          }
        }

        const options = {
          models: [Order]
        }

        it("check all hooks that have signatures with promises.", function * () {
          pers = new Persistanz(dbConf, options);
          var result = yield pers.create();
          assert(result === true, "Create should succeed and must return true.");
          //get a customer (R2D2 from the previous suite.)
          var c = yield pers.m.Customer.q().one();
          //cancelled save:
          var saveResult = yield pers.saveAs({}, "Order"); //beforeSave #1
          assert(saveResult.status === 'cancelled', ".beforeSave() should prevent saving without a customerId.");
          //validate:
          var o = yield pers.q().f("Order").one();
          assert(o === null, "There can't be any saved order.");
          //processed save:
          var saveResult = yield pers.saveAs({customerId: c.id}, "Order"); //beforeSave #2, afterSave #1
          assert(saveResult.status === 'saved', ".beforeSave() should allow saving with a customerId.");
          assert(saveResult.object.dateTime != null, ".beforeSave() should set a date.");
          //validate:
          var o = yield pers.q().f("Order").one(); //afterLoad #1
          assert(o instanceof pers.m.Order, "We should have an order now.");
          //cancelled delete:
          delete o.customerId;
          var deleteResult = yield o.delete(); //beforeDelete #1
          assert(deleteResult.status === 'cancelled', ".beforeDelete() should prevent deleting without a customerId.");
          //validate:
          var o = yield pers.q().f("Order").one(); //afterLoad #2
          assert(o instanceof pers.m.Order, "We should still have an order.");
          //processed delete:
          var deleteResult = yield o.delete(); //beforeDelete #2, afterDelete #1
          assert(deleteResult.status === 'deleted', ".afterDelete() should allow deleting with a customerId.");
          //validate:
          var o = yield pers.q().f("Order").one();
          assert(o === null, "We should not have an order anymore.");
          /*********** make sure each hook is called as expected ************/
          assert(hookCalls.beforeSave === 2);
          assert(hookCalls.afterSave === 1);
          assert(hookCalls.beforeDelete === 2);
          assert(hookCalls.afterDelete === 1);
          assert(hookCalls.afterLoad === 2);
          yield pers.destroy();
        });

      });

      describe("model hooks with callbacks (with same data.)", function () {
        const hookCalls = {
          beforeSave: 0, afterSave: 0, beforeDelete: 0, afterDelete: 0, afterLoad: 0,
        }

        class Order {
          beforeSave(tx, command, cb) {
            hookCalls.beforeSave ++;
            if (this.customerId == null) return cb(null, false);
            this.dateTime = new Date();
            return cb(null, true);
          }

          afterSave(tx, command, cb) {
            hookCalls.afterSave ++;
            return cb(null);
          }

          beforeDelete(tx, cb) {
            hookCalls.beforeDelete ++;
            if (this.customerId == null) return cb(false);
            return cb(null, true);
          }

          afterDelete(tx, cb) {
            hookCalls.afterDelete ++;
            return cb(null);
          }

          afterLoad(tx, cb) {
            hookCalls.afterLoad ++;
            return cb(null);
          }
        }

        const options = {
          models: [Order]
        }

        it("check all hooks that have a signature with a callback.", function * () {
          pers = new Persistanz(dbConf, options);
          var result = yield pers.create();
          assert(result === true, "Create should succeed and must return true.");
          //get a customer (R2D2 from the previous suite.)
          var c = yield pers.m.Customer.q().one();
          //cancelled save:
          var saveResult = yield pers.saveAs({}, "Order"); //beforeSave #1
          assert(saveResult.status === 'cancelled', ".beforeSave() should prevent saving without a customerId.");
          //validate:
          var o = yield pers.q().f("Order").one();
          assert(o === null, "There can't be any saved order.");
          //processed save:
          var saveResult = yield pers.saveAs({customerId: c.id}, "Order"); //beforeSave #2, afterSave #1
          assert(saveResult.status === 'saved', ".beforeSave() should allow saving with a customerId.");
          assert(saveResult.object.dateTime != null, ".beforeSave() should set a date.");
          //validate:
          var o = yield pers.q().f("Order").one(); //afterLoad #1
          assert(o instanceof pers.m.Order, "We should have an order now.");
          //cancelled delete:
          delete o.customerId;
          var deleteResult = yield o.delete(); //beforeDelete #1
          assert(deleteResult.status === 'cancelled', ".beforeDelete() should prevent deleting without a customerId.");
          //validate:
          var o = yield pers.q().f("Order").one(); //afterLoad #2
          assert(o instanceof pers.m.Order, "We should still have an order.");
          //processed delete:
          var deleteResult = yield o.delete(); //beforeDelete #2, afterDelete #1
          assert(deleteResult.status === 'deleted', ".afterDelete() should allow deleting with a customerId.");
          //validate:
          var o = yield pers.q().f("Order").one();
          assert(o === null, "We should not have an order anymore.");
          /*********** make sure each hook is called as expected ************/
          assert(hookCalls.beforeSave === 2);
          assert(hookCalls.afterSave === 1);
          assert(hookCalls.beforeDelete === 2);
          assert(hookCalls.afterDelete === 1);
          assert(hookCalls.afterLoad === 2);
          yield pers.destroy();
        });

      });

      describe("Single table inheritance", function () {

        const options = {
          models: [
            {
              model: "Product",
              submodels: [
                {
                  model: "Hat",
                  discriminator: "__type",

                },
                {
                  model: "Shirt",
                  discriminator: "__type"
                }
              ]
            },
            { //prevent OrderItem to throw due to multiple product bfs:
              model: "OrderItem",
              bridgeFields: {
                product: {modelName: "Product", fkColumn: "productId"},
                hat: {modelName: "Hat", fkColumn: "productId"},
                shirt: {modelName: "Shirt", fkColumn: "productId"},
              }
            }
          ]
        }

        it("persistanz should not complain and generate correct mappings based on above configuration.", function * () {
          pers = new Persistanz(dbConf, options);
          var result = yield pers.create();
          assert(result === true, "Create should succeed and must return true.");
          assert("Product" in pers.models, "Product model should exist.");
          assert("Hat" in pers.models, "Hat model should exist.");
          assert("Shirt" in pers.models, "Shirt model should exist.");
        });

        it("polymorphic associations (brigde field)", function * () {
          var saveResult = yield pers.saveAs({title_en: "White shirt", title_tr: "Beyaz gömlek"}, "Shirt");
          assert(saveResult.object instanceof pers.m.Shirt, "Saved object is an instance of Shirt.");

          var shirt = yield pers.m.Shirt.q().s("id, title_en").one();
          assert(shirt instanceof pers.m.Shirt);
          assert(! ("__type" in shirt), "__type attribute should not be present in shirt, we didn't ask for it.");

          var hat = yield pers.m.Hat.q().s("*").one();
          assert(hat === null, "There is no hat ;)");

          //bring the mighty R2D2:
          var c = yield pers.q().f("Customer").one();
          var orderSaved = yield pers.saveAs({customerId: c.id, dateTime: new Date()}, "Order");
          var saveResult = yield pers.saveAs({orderId: orderSaved.lastInsertId, productId: shirt.id}, "OrderItem");
          assert(saveResult.lastInsertId != null, "Make sure the order item is saved.");

          //now select the polymorphic product through order item:
          var oi = yield pers.q().f("OrderItem").s("*, product.*").one();
          assert(oi.product instanceof pers.m.Product, "product property of oi must reflect the original product as a Product");
          var oi = yield pers.q().f("OrderItem").s("*, shirt.*").one();
          assert(oi.shirt instanceof pers.m.Shirt, "shirt property of oi must reflect the original product as a Shirt");
          var oi = yield pers.q().f("OrderItem").s("*, hat.*").one();
          assert("hat" in oi, "hat property must be present in order item.");
          assert(oi.hat === null, "but should be null, because a Hat is not a Shirt");
        });

        it("polymorphic associations (toMany)", function * () {
          //create 2 prodict categories and 3 products:
          var casualId = (yield pers.saveAs({title: "Casual"}, "ProductCategory")).lastInsertId;
          var businessId = (yield pers.saveAs({title: "Business"}, "ProductCategory")).lastInsertId;

          yield pers.saveAs({title_en: "Silk Shirt", title_tr: "İpek Gömlek", categoryId: businessId}, "Shirt");
          yield pers.saveAs({title_en: "Cashmere Shirt", title_tr: "Kaşmir Gömlek", categoryId: casualId}, "Shirt");
          yield pers.saveAs({title_en: "Baseball Hat", title_tr: "Beyzbol Şapkası", categoryId: casualId}, "Hat");

          //let's see if toMany respects the types:
          var casual = yield pers.loadById("ProductCategory", casualId, "*, products.*");
          assert(casual.products.length === 2, "We inserted 2 products with casual product.");
          var casual = yield pers.loadById("ProductCategory", casualId, "*, shirts.*");
          assert(casual.shirts.length === 1, "We inserted 1 casual shirt...");
          assert(casual.shirts[0].title_en === 'Cashmere Shirt', "which is a cashmere shirt.");
          var casual = yield pers.loadById("ProductCategory", casualId, "*, hats.*");
          assert(casual.hats.length === 1, "We inserted 1 casual hat...");
          assert(casual.hats[0].title_en ===  'Baseball Hat', "which is a baseball hat.");
          //finally:
          var business = yield pers.loadById("ProductCategory", businessId, "*, hats.*, shirts.*, products.*");
          assert(business.hats.length === 0, "We have no business hats, sorry.");
          assert(business.shirts.length === 1, "We have 1 business shirt...");
          assert(business.shirts[0].title_en === "Silk Shirt", "and it is Silk Shirt.");
          assert(business.products.length === 1, "naturally");
          assert(business.products[0].id === business.shirts[0].id,
            "the only business product we have is the same as only business shirt we have.");
          yield pers.destroy();
        });

      });

      describe("Column serialization (JSON)", function () {

        const options = {
          models: [
            {
              model: "Product",
              serialization: {
                attributes: { type: "json", default: "{}" },
              },
              submodels: [
                {
                  model: "Hat",
                  discriminator: "__type",

                },
                {
                  model: "Shirt",
                  discriminator: "__type"
                }
              ]
            },
            { //prevent OrderItem to throw due to multiple product bfs:
              model: "OrderItem",
              bridgeFields: {
                product: {modelName: "Product", fkColumn: "productId"},
                hat: {modelName: "Hat", fkColumn: "productId"},
                shirt: {modelName: "Shirt", fkColumn: "productId"},
              }
            }
          ]
        }

        it("JSON serialization on base model.", function * () {
          pers = new Persistanz(dbConf, options);
          var result = yield pers.create();
          assert(result === true, "Create should succeed and must return true.");
          //basic product insert with attribute value:
          var attributes = {sex: "male", size: "L"};
          var bsId = (yield pers.saveAs({title_en: "Batman Shirt", title_tr: "Batman Gömleği", __type: "Shirt", attributes}, "Product")).lastInsertId;
          var batmanShirt = yield pers.loadById("Product", bsId);
          assert(typeof batmanShirt.attributes === 'object', "it should come here as an object, not text.");
          assert(batmanShirt.attributes.sex === 'male', "as we entered.");
          //basic product insert without attribute value:
          var psId = (yield pers.saveAs({title_en: "Pokemon Shirt", title_tr: "Pokemon Gömleği", __type: "Shirt"}, "Product")).lastInsertId;
          var pokemonShirt = yield pers.loadById("Product", psId);
          assert(typeof pokemonShirt.attributes === 'object', "it should come here as an object, not text even thought we didn't set.");
          assert(pokemonShirt.attributes != null, "default is null, but we set the default to be {}.");
          assert(JSON.stringify(pokemonShirt.attributes) === '{}', "Make sure the default value is written and read back.");
        });

        it("JSON serialization on submodel (serialization inheritance).", function * () {
          //basic product insert with attribute value:
          var attributes = {sex: "female", size: "L"};
          var bsId = (yield pers.saveAs({title_en: "Batman Shirt", title_tr: "Batman Gömleği", attributes}, "Shirt")).lastInsertId;
          var batmanShirt = yield pers.loadById("Shirt", bsId);
          assert(typeof batmanShirt.attributes === 'object', "it should come here as an object, not text.");
          assert(batmanShirt.attributes.sex === 'female', "as we entered.");
          //basic product insert without attribute value:
          var swsId = (yield pers.saveAs({title_en: "Star Wars Shirt", title_tr: "Star Wars Gömleği"}, "Shirt")).lastInsertId;
          var starWarsShirt = yield pers.loadById("Shirt", swsId);
          assert(typeof starWarsShirt.attributes === 'object', "it should come here as an object, not text even thought we didn't set.");
          assert(starWarsShirt.attributes != null, "default is null, but we set the default to be {}.");
          assert(JSON.stringify(starWarsShirt.attributes) === '{}', "Make sure the default value is written and read back.");
          yield pers.destroy();
        });

      });

      describe("Column serialization (Custom)", function () {

        const options = {
          models: [
            {
              model: "Product",
              serialization: {
                attributes: {
                  type: "custom",
                  default: () => "NOTHING",
                  options: {
                    serialize: objectValue => {
                      var serArr = [];
                      for (var key in objectValue) {
                        serArr.push(key + ": " + objectValue[key]);
                      }
                      return serArr.join("\n");
                    },
                    deserialize: dbValue => {
                      var result = {};
                      if (dbValue === 'NOTHING') return result;
                      dbValue.split("\n").forEach(attr => {
                        var parts = attr.split(':');
                        var key = parts.shift();
                        result[key] = parts.join(':').trim();
                      });
                      return result;
                    }
                  }
                },
              },
              submodels: [
                {
                  model: "Hat",
                  discriminator: "__type",

                },
                {
                  model: "Shirt",
                  discriminator: "__type"
                }
              ]
            },
          ]
        }

        it("Custom serialization.", function * () {
          pers = new Persistanz(dbConf, options);
          var result = yield pers.create();
          assert(result === true, "Create should succeed and must return true.");
          var eProductTable = pers.escapeId("Product");
          //basic product insert with attribute value:
          var attributes = {sex: "male", size: "L"};
          var jsId = (yield pers.saveAs({title_en: "Joker Shirt", title_tr: "Joker Gömleği", __type: "Shirt", attributes}, "Product")).lastInsertId;
          //validate by reading the db directly:
          var rows = yield pers.adapter.query(`select attributes from ${eProductTable} where id = ? limit 1`, jsId);
          assert(rows[0].attributes.indexOf("sex: male") != -1, "Make sure our custom format is in the db.");
          var jokerShirt = yield pers.loadById("Product", jsId);
          assert(typeof jokerShirt.attributes === 'object', "it should come here as an object, not text.");
          assert(jokerShirt.attributes.sex === 'male', "as we entered.");
          //basic product insert without attribute value:
          var ssId = (yield pers.saveAs({title_en: "Superman Shirt", title_tr: "Süpermen Gömleği", __type: "Shirt"}, "Product")).lastInsertId;
          var rows = yield pers.adapter.query(`select attributes from ${eProductTable} where id = ? limit 1`, ssId);
          assert(rows[0].attributes === 'NOTHING', "Make sure our custom format is in the db.");
          var supermanShirt = yield pers.loadById("Product", ssId);
          assert(typeof supermanShirt.attributes === 'object', "it should come here as an object, not text even thought we didn't set.");
          assert(supermanShirt.attributes != null, "default is null, but we set the default to be {}.");
          assert(JSON.stringify(supermanShirt.attributes) === '{}', "Make sure the default value is written and read back.");
          yield pers.destroy();
        });

      });

    });
  }
});
