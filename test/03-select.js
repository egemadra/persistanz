"use strict";
var prepare = require("./attic/prepare.js");
var conf = prepare.loadConfig();
var Persistanz = require("../lib/Persistanz.js");
var assert = require("chai").assert;
require('co-mocha');

describe("Select queries without a configuration", function(done) {

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

      function * insertAFewRecords () {
        var dw = yield pers.saveAs({name: "Darth Vader"}, "Customer");
        var ls = yield pers.saveAs({name: "Luke Skywalker"}, "Customer");

        var dateTime = new Date();
        var dwo1 = yield pers.saveAs({customerId: dw.lastInsertId, dateTime}, "Order");
        var dwo2 = yield pers.saveAs({customerId: dw.lastInsertId, dateTime}, "Order");
        var lso1 = yield pers.saveAs({customerId: ls.lastInsertId, dateTime}, "Order");
        //few products:
        var ws = yield pers.saveAs({title_en: "White Shirt", title_tr: "Beyaz Gömlek", __type: "Shirt"}, "Product");
        var bus = yield pers.saveAs({title_en: "Blue Shirt", title_tr: "Mavi Gömlek", __type: "Shirt"}, "Product");
        var bls = yield pers.saveAs({title_en: "Black Shirt", title_tr: "Siyah Gömlek", __type: "Shirt"}, "Product");
        //few order items:
        yield pers.saveAs({orderId: dwo1.lastInsertId, productId: bls.lastInsertId}, "OrderItem"); //black shirt for Vader.
        yield pers.saveAs({orderId: dwo1.lastInsertId, productId: bus.lastInsertId}, "OrderItem"); //blue shirt for Vader.

        yield pers.saveAs({orderId: lso1.lastInsertId, productId: ws.lastInsertId}, "OrderItem"); //white shirt for Luke.
        yield pers.saveAs({orderId: lso1.lastInsertId, productId: bus.lastInsertId}, "OrderItem"); //blue shirt for Luke.

        yield pers.saveAs({orderId: dwo2.lastInsertId, productId: ws.lastInsertId}, "OrderItem"); //white shirt for Vader.
        //few addresses:
        yield pers.insertAs({customerId: dw.lastInsertId, address:"Death Star 1", id: 77}, "Address");
        yield pers.insertAs({customerId: ls.lastInsertId, address:"Tatooine", id: 108}, "Address");
      }

      it("Bridge fields: select and order", function * (){
        yield insertAFewRecords();
        var orders = yield pers.q().f("Order").s("*, customer.*").o("{customer.name} desc").exec();
        assert(Array.isArray(orders), "Orders collection is an array.");
        assert(orders.length === 3, "We have 3 orders.");
        assert(orders[0].customer.name === 'Luke Skywalker', "Luke must come first due to order by clause.");
        assert("dateTime" in orders[0], "dateTime must be in the orders.");
      });

      it("! operator", function * (){
        var orders = yield pers.q().f("Order").s("*, !dateTime, customer.*, !customer.name").exec();
        assert(! ("dateTime" in orders[0]), "We excluded the dateTime field in order.");
        assert(! ("name" in orders[0].customer), "We excluded the customer name.");
        assert("id" in orders[0].customer, "But we included the id.");
      });

      it("select with", function * (){
        var orders = yield pers.q().f("Order").s("*, !dateTime").sw("customer", "*, !name").exec();
        assert(! ("dateTime" in orders[0]), "We excluded the dateTime field in order.");
        assert(! ("name" in orders[0].customer), "We excluded the customer name.");
        assert("id" in orders[0].customer, "But we included the id.");
      });

      it("where clause", function * (){
        var orders = yield pers.q().f("Order").s("*, customer.*")
          .w("{customer.name} like ?", '%walk%').exec();
        assert(orders.length === 1, "Luke has 1 order");
        assert(orders[0].customer.name === 'Luke Skywalker', "Luke.");
      });

      it("where clause with tagged template", function * (){
        var orders = yield pers.q().f("Order").s("*, customer.*")
          .w`{customer.name} like ${'%walk%'}`.exec();
        assert(orders.length === 1, "Luke has 1 order");
        assert(orders[0].customer.name === 'Luke Skywalker', "Luke.");
      });

      it("where clause with tagged template, using array", function * (){
        var names = ["Luke Skywalker"];
        var orders = yield pers.q().f("Order").s("*, customer.*")
          .w`{customer.name} in ( ${names} )`.exec();
        assert(orders.length === 1, "Luke has 1 order");
        assert(orders[0].customer.name === 'Luke Skywalker', "Luke.");
      });

      it("where clause with tagged template, using subquery", function * (){
        var subQuery = pers.q().f("Customer").s("id").o("{name} asc")
          .w("{name} = ?", "Darth Vader");
        var orders = yield pers.q().f("Order").s("*, customer.*")
          .w`{customerId} in ( ${subQuery} )`.exec();
        assert(orders.length === 2, "Darth has 2 orders");
        assert(orders[0].customer.name === 'Darth Vader', "Vader.");
        assert(orders[1].customer.name === 'Darth Vader', "Vader.");
      });

      it("limit clause", function * (){
        var limit = 1, offset = 2;
        var orders = yield pers.q().f("Order").s("*, customer.*").o("{customer.name}")
          .limit("? OFFSET ?", [limit, offset]).exec();
        assert(orders.length === 1, "We limited by 1");
        assert(orders[0].customer.name === 'Luke Skywalker', "3rd order is by Luke.");
      });

      it("limit clause with tagged template", function * (){
        var limit = 1, offset = 2;
        var orders = yield pers.q().f("Order").s("*, customer.*").o("{customer.name}")
          .limit`${limit} OFFSET ${offset}` .exec();
        assert(orders.length === 1, "We limited by 1");
        assert(orders[0].customer.name === 'Luke Skywalker', "3rd order is by Luke.");
      });

      it("distinct", function * (){
        //don't add "id" to select clause.
        var orders = yield pers.q().f("Order").s("dateTime, customer.*").distinct().exec();
        assert(orders.length === 2, "2 distinct orders, one by Luke, one by Vader.");
      });

      it("query options", function * (){
        //don't add "id" to select clause.
        var orders = yield pers.q().f("Order").s("dateTime, customer.*").options("DISTINCT").exec();
        assert(orders.length === 2, "2 distinct orders, one by Luke, one by Vader.");
      });

      it("calc", function * () {
        var orders = yield pers.q().f("Order")
          .w("{customer.name} = ?", "Darth Vader").calc().limit("?", 1).exec();
        assert(typeof orders === 'object', "with calc, exec return is not an array but an object");
        assert("objects" in orders, "should have an objects key.");
        assert(Array.isArray(orders.objects), "objects key is an array.");
        assert("count" in orders, "should have a count key.");
        assert(orders.objects.length === 1, "We limited the result set to 1 item");
        assert(orders.count === 2, "But vader has 2 orders in total.");
      });

      it("index with fields", function * () {
        //we used non-unique index, meaning we can't get at most 1 order per customer:
        var orders = yield pers.q().f("Order").s("*, customer.*")
          .index("customer.name").order("{customer.name} desc").exec();
        assert(orders instanceof Map, "exec with index return value is a Map object.");
        assert(orders.size === 2, "No where or limit, but we have 1 order from each customer.");
        assert(orders.get("Luke Skywalker") instanceof pers.m.Order, "each item is an order");
        assert(Array.from(orders.keys())[0] === 'Luke Skywalker', ".index() must respect the order by clause.");
        assert(Array.from(orders.keys())[1] === 'Darth Vader', ".index() must respect the order by clause.");
      });

      it("index with callbacks", function * () {
        //we used a unique index this time:
        var orders = yield pers.q().f("Order").s("*, customer.*")
          .index( order => order.id + ":" + order.customer.name)
          .order("{customer.name} desc, {id} asc").exec();
        assert(orders instanceof Map, "exec with index return value is a Map object.");
        assert(orders.size === 3, "All items should have been returned.");
        assert(orders.get("3:Luke Skywalker") instanceof pers.m.Order, "each item is an order");
        assert(Array.from(orders.keys())[0] === '3:Luke Skywalker', ".index() must respect the order by clause.");
        assert(Array.from(orders.keys())[1] === '1:Darth Vader', ".index() must respect the order by clause.");
        assert(Array.from(orders.keys())[2] === '2:Darth Vader', ".index() must respect the order by clause.");
      });

      it("calc with index", function * () {
        var orders = yield pers.q().f("Order").calc().limit(1)
          .w("{customer.name} = ?", "Darth Vader").index("customer.name").exec();
        assert(typeof orders === 'object', "with calc, exec return is not an array but an object");
        assert("objects" in orders, "should have an objects key.");
        assert(orders.objects instanceof Map, "objects is a Map.");
        assert("count" in orders, "should have a count key.");
        assert(orders.objects.size === 1, "We limited the result set to 1 item");
        assert(orders.count === 2, "But vader has 2 orders in total.");
        assert(orders.objects.get("Darth Vader") instanceof pers.m.Order, "Each item in the map is an Order.");
      });

      it("selectAlias", function * () {
        var orders = yield pers.q().f("Order").s("*").o("{customer.name} desc")
          .sa('{customer.name} AS "customerName", 1+1 as two').exec();

        assert("two" in orders[0], "there must be a key named 'two' in each order.");
        assert("customerName" in orders[0], "there must be a key named 'customerName' in each order.");
        assert(orders[0].customerName === 'Luke Skywalker', "selected alias customerName must reflect the name.");
        assert(+orders[0].two === 2, "two should come as 2 in all databases.");
      });

      //this is failing for postgres, because the builder adds customer.id into the select clause
      //and postgres doesn't like non-aggregated columns from non-group in the query.
      it("group by", function * () {
        var orders =  yield pers.q().f("Order").sa("{customer.name}")
          .g("{customer.name}").exec();

        assert(orders.length === 2, "One order from each customer means 2.");
      });

      it("having, normal method call", function * () {
        var orders = yield  pers.q().f("Order").sa("{customer.name} as name")
          .g("{customer.name}").h("{customer.name} = ?", "Darth Vader").exec();
        assert(orders.length === 1, "Only 1 customer should be in the results.");
        assert(orders[0].name === 'Darth Vader', "and that is Darth Vader.");
      });

      it("having, tagged template call", function * () {
        var orders = yield  pers.q().f("Order").sa("{customer.name} as name")
          .g("{customer.name}").h`{customer.name} = ${"Darth Vader"}`.exec();
        assert(orders.length === 1, "Only 1 customer should be in the results.");
        assert(orders[0].name === 'Darth Vader', "and that is Darth Vader.");
      });

      it("streaming queries", function * () {
        var called = 0;
        var endCalled = false;
        var totalCount = 0;
        var endCalled = false;

        var orders = yield pers.q().f("Order").s("*, customer.*").index("id").calc()
          .on("object", (order, index) => {
            called ++;
            assert(order instanceof pers.m.Order, "an order object is of type Order");
            assert("customer" in order, "there is a customer field...");
            assert("name" in order.customer, "and it thas a name.");
            assert(typeof index === "number" && index > 0, "we indexed by id, so it must be nr greater than zero.");
          })
          .on("calc", count => {
            totalCount = count;
          })
          .on("end", () => {
            endCalled = true;
          })
          .exec();

        assert(called === 3, "object callback should have been called 3 times.");
        assert("count" in orders, "even streaming queries return a count field with calc.");
        assert(orders.count === 3, "which is 3.");
        assert(totalCount === 3, "calc callback must be called with count=3 too");
        assert(orders.objects === true, "we don't have real objects here, only true.");
        assert(endCalled === true, "end callback should have been called.");
      });

      it("field abstraction over affix", function * () {
        pers.setAbstractAffix("_en", "suffix");
        var products = yield pers.q().f("Product").s("id, title")
          .index("title")
          .w("{title} like ?", "%Bl%")
          .o("{title}")
          .exec();

        assert(products.has("Black Shirt"), "Black shirt must exit in our map");
        assert(products.has("Blue Shirt"), "Blue shirt must exit in our map");
        var bs = products.get("Blue Shirt");
        assert("title" in bs, "Product must have a 'title' field.");
        assert(bs.title === 'Blue Shirt', "and it must read 'Blue Shirt'");
        assert( ! ("title_en" in bs), "title_en, shoud not appear in the object, we didn't ask for it.");
        assert(Array.from(products.keys())[0] === 'Black Shirt', "order by should work under abstraction and be respected.");
      });

      it("field abstraction over affix cancellation", function * () {
        //cancel only _en
        pers.setAbstractAffix("_en", null);
        try {
          var products = yield pers.q().f("Product").s("id, title").exec();
          assert(false, "Should not come here.");
        } catch (err) {
          assert(err.message.includes("cannot be resolved"), "must report unresolved field.");
        }
        //reset it to _tr
        pers.setAbstractAffix("_tr");
        var products = yield pers.q().f("Product").s("title").w("{title} like ?", ["%Beyaz%"]).exec();
        assert(products.length === 1, "Only 1 product must be in the record set.");
        assert(products[0].title === 'Beyaz Gömlek', "and it is the white shirt.");
        //cancel all.
        pers.setAbstractAffix(null);
        try {
          var products = yield pers.q().f("Product").s("title").w("{title} like ?", ["%Beyaz%"]).exec();
          assert(false, "Should not come here.");
        } catch (err) {
          assert(err.message.includes("cannot be resolved"), "must report unresolved field.");
        }
      });

      it("tomany queries with inline select", function * () {
        //pull the entire data in our database starting with the Customer:
        var customers = yield pers.q().f("Customer")
          .s("*, orders.*, orders.orderItems.*, orders.orderItems.product.*")
          .o("{name} asc") //Vader comes first
          .exec();
        assert("orders" in customers[0], "each customer has an orders key.");
        assert(Array.isArray(customers[0].orders), "which is an array");
        assert(customers[0].name === "Darth Vader", "first is vader");
        assert(customers[0].orders.length === 2, "Vader has 2 orders");
        assert(Array.isArray(customers[0].orders[0].orderItems), "orderItems is an array.");
        assert(customers[0].orders[0].orderItems.length === 2, "Vader's first order has 2 items");
        assert("title_en" in customers[0].orders[0].orderItems[0].product, "each orderItem has product property, which has a title_en");
      });

      it("tomany queries with toMany() method and clauses", function * () {
        var customers = yield pers.q().f("Customer")
          .s("*").o("{name} asc") //Vader comes first
          .toMany("orders").s("*").w("{customer.name} = ?", "Luke Skywalker")
          .toMany("orders.orderItems").s("*, product.*").o("{product.title_en}")
          .exec();

        assert("orders" in customers[0], "each customer has an orders key.");
        assert(Array.isArray(customers[0].orders), "which is an array");
        assert(customers[0].name === "Darth Vader", "first is vader");
        //despite we have all customers, orders subquery is filtered to fetch only Luke's orders:
        assert(customers[0].orders.length === 0, "We didn't select Vader's orders")
        assert(customers[1].orders.length === 1, "Luke has 1 orders");
        assert(Array.isArray(customers[1].orders[0].orderItems), "orderItems is an array.");
        assert(customers[1].orders[0].orderItems.length === 2, "Luke's only order has 2 items");
        assert("title_en" in customers[1].orders[0].orderItems[0].product, "each orderItem has product property, which has a title_en");
        assert(customers[1].orders[0].orderItems[0].product.title_en === 'Blue Shirt', "Luke's first item reads Blue Shirt as we ordered the items by their title_en");
      });

      it("tomany queries with toMany() method and parallel toMany queries", function * () {
        var customers = yield pers.q().f("Customer")
          .s("*").o("{name} asc") //Vader comes first
          .toMany("orders").s("*").w("{customer.name} = ?", "Luke Skywalker")
          .toMany("orders.orderItems").s("*, product.*").o("{product.title_en}")
          .toMany("addresses").s("*").index("id") //not part of previous toManys.
          .exec();

        assert("orders" in customers[0], "each customer has an orders key.");
        assert(Array.isArray(customers[0].orders), "which is an array");
        assert(customers[0].name === "Darth Vader", "first is vader");
        //despite we have all customers, orders subquery is filtered to fetch only Luke's orders:
        assert(customers[0].orders.length === 0, "We didn't select Vader's orders")
        assert(customers[1].orders.length === 1, "Luke has 1 orders");
        assert(Array.isArray(customers[1].orders[0].orderItems), "orderItems is an array.");
        assert(customers[1].orders[0].orderItems.length === 2, "Luke's only order has 2 items");
        assert("title_en" in customers[1].orders[0].orderItems[0].product, "each orderItem has product property, which has a title_en");
        assert(customers[1].orders[0].orderItems[0].product.title_en === 'Blue Shirt', "Luke's first item reads Blue Shirt as we ordered the items by their title_en");
        //addresses
        assert("addresses" in customers[0], "customers have their adresses,");
        assert(customers[0].addresses instanceof Map, "and they are Maps.");
        //we may not have Vader's orders but we have his addresses:
        assert(customers[0].addresses.get(77) instanceof pers.m.Address, "Each item in addrsses is an Address.");
        assert(customers[0].addresses.get(77).address === 'Death Star 1', "One of Vader's addresses is DS1.");
      });

    });
  }
});
