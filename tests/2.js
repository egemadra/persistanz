"use strict";
var pc=require("../lib/common.js").pc;
var co=require("co");
var Persistanz=require("../lib/Persistanz.js");
var prepare=require("./attic/prepare.js");
var assert=require("assert");
var conf=require("./conf.js");

let persConf={
  models:[
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
    }
  ]
}

co(function*(){
  for (var adapterName of conf.applyTestsTo)
  {
    var dbConf=conf.dbConfigs[adapterName];
    dbConf.adapter=adapterName;

    console.log("Running 2.js tests for "+adapterName);
    yield prepare.createTestDatabase(dbConf);
    var pers=new Persistanz(dbConf, persConf);
    yield pers.create();
    /**************************************************************************/

    //create some rows:
    //products:

    let gh=(yield pers.m.Product.save({title_en:"Green Hat", title_tr:"Yeşil Şapka", "__type": "Hat"})).object;
    let rh=(yield pers.m.Product.save({title_en:"Red Hat", title_tr:"Kırmızı Şapka", "__type": "Hat"})).object;
    let bs=(yield pers.m.Product.save({title_en:"Blue Shirt", title_tr:"Mavi Gömlek", "__type": "Shirt"})).object;
    let ws=(yield pers.m.Product.save({title_en:"White Shirt", title_tr:"Beyaz Gömlek", "__type": "Shirt"})).object;
    //save as Shirt subclass
    let ys=(yield pers.m.Shirt.save({title_en:"Yellow Shirt", title_tr:"Sarı Gömlek"})).object;

    //customers
    let alice=(yield pers.m.Customer.save({name: "Alice"})).object;
    let bob=(yield pers.m.Customer.save({name: "Bob"})).object;
    let carol=(yield pers.m.Customer.save({name: "Carol"})).object;

    //alice has an order:
    let order=(yield pers.m.Order.save({customerId: alice.id, dateTime: new Date()})).object;
    //alice gets a green hat
    yield pers.m.OrderItem.save({orderId: order.id, productId:gh.id, dateTime: new Date()});
    //and a blue shirt
    yield pers.m.OrderItem.save({orderId: order.id, productId:bs.id, dateTime: new Date()});

    //bob has an order:
    order=(yield pers.m.Order.save({customerId: bob.id, dateTime: new Date()})).object;
    //bob buys a green hat
    yield pers.m.OrderItem.save({orderId: order.id, productId:gh.id, dateTime: new Date()});
    //and a yellow shirt
    yield pers.m.OrderItem.save({orderId: order.id, productId:ys.id, dateTime: new Date()});

    /**************************************************************************/

    //see bridge fields in query clauses:

    //get all orders, with customers:
    let orders=yield pers.q().f("Order")
      .s("*, customer.*").order("{customer.name} desc").exec();

    assert(orders.length===2);
    assert(orders[0].customer.name==="Bob");

    //get all order items with their products and orders in addition to
    //orders' customer names which the item has yellow shirt in it, sort by
    //order date descending:
    let orderItems=yield pers.m.OrderItem.q()
      .s("*, order.id, order.customer.name, product.*")
      .w("{product.id}=?", ys.id)
      .o("{order.dateTime} desc") //q returns 1 result, point is just to show.
      .exec();

    //we know only bob has it, so:
    assert(orderItems.length===1);
    assert(orderItems[0].productId===ys.id);
    assert(orderItems[0].product.title_en==="Yellow Shirt");
    assert(orderItems[0].order.customerId===undefined); //we didn't select
    assert(orderItems[0].order.customer.id===undefined); //we didn't select
    assert(orderItems[0].order.customer.name==="Bob");

    //"select with" demo with the same query:
    let sameOrderItems=yield pers.m.OrderItem.q()
      .s('*, product.*')
      .sw("order", "id, customer.name")
      .w("{product.id}=?", ys.id)
      .exec();

    assert.deepStrictEqual(sameOrderItems, orderItems);

    //same with ! operator usage:
    let yetAgain=yield pers.m.OrderItem.q()
      .s("*, order.id, order.customer.*, !order.customer.id,  product.*")
      .w("{product.id}=?", ys.id)
      .exec();

    assert.deepStrictEqual(yetAgain, orderItems);

    //inheritence:
    var shirts=yield pers.q().f("Shirt").o("{id}").exec();
    var shirtProducts=yield pers.q().f("Product").w("{__type}='Shirt'").o("{id}").exec();

    assert(shirts.length===shirtProducts.length);
    for (var i in shirts)
      assert.deepEqual(shirts[i], shirtProducts[i]);

    //subqueries can be used in where clauses of other queries.
    //select items that contain hats, bring the purchaser names along with them.
    let hatQuery=pers.q().f("Hat").s("id");
    var items=yield pers.q().f("OrderItem").s("order.customer.name")
      .w("{productId} in ?", hatQuery)
      .o("{order.customer.name} desc")
      .exec();
    assert(items[0].order.customer.name==="Bob");
    assert(items[1].order.customer.name==="Alice")

    //tomany properties:

    //bring customers with their orders. Let's index by their name this time:
    let customers=yield pers.q().f("Customer").s("*, orders.*").index("name").exec();
    assert("orders" in customers.get("Alice"));
    assert(Array.isArray(customers.get("Alice").orders));
    assert("orders" in customers.get("Carol"));
    assert(Array.isArray(customers.get("Carol").orders));
    assert(customers.get("Alice").orders.length===1);
    assert(customers.get("Bob").orders.length===1);
    assert(customers.get("Carol").orders.length===0);

    //bring deeper into the products:
    //note that we don't pull anything from OrderItem directly.
    //query builder and the mapper should be able to handle this.
    customers=yield pers.q().f("Customer")
      .s("*, orders.*, orders.orderItems.product.title_en")
      .o("{name}")
      .exec();

    for (var c of customers)
      if (c.name==="Carol")
        assert(Array.isArray(c.orders) && c.orders.length===0);
      else if (c.name==='Alice')
      {
        assert("orderItems" in c.orders[0])
        assert(c.orders[0].orderItems.length===2);
        c.orders[0].orderItems.forEach(function(oi){
          assert("product" in oi);
          assert("title_en" in oi.product);
          assert(["Green Hat", "Blue Shirt"].indexOf(oi.product.title_en)>-1)
        });
      }
      else if (c.name==='Bob')
      {
        c.orders[0].orderItems.forEach(function(oi){
          assert("product" in oi);
          assert("title_en" in oi.product);
          assert(["Green Hat", "Yellow Shirt"].indexOf(oi.product.title_en)>-1)
        });
      }

      //unfortunately, it still brings remote foreign keys even if not asked:
      try{
        assert(customers[0].orders[0].orderItems[0].orderId==undefined);
      }
      catch(err){
        console.log("Fix this: remote foreign keys in toMany columns are present even if not used in select.");
      }

      //"field abstraction over affix" feature:
      pers.setAbstractAffix("_tr", "suffix");
      let products=yield pers.q().f("Product")
        .s("id, title")
        .w("{title} like '%ı%'") //dotless i used in Turkish.
        .o("{title} desc")
        .group("{title}, {id}")
        .exec();

      assert(products[0].title==="Sarı Gömlek");
      assert(products[1].title==="Kırmızı Şapka");
      assert(products[0].title_tr===undefined);

      //cancel the feature:
      pers.setAbstractAffix(null);
      yield pers.q().f("Product").s("id, title").exec().then(function(){
        assert(false);
      }).catch(function(err){
        assert(err.toString().indexOf("Can't resolve field")>0);
      });

      //transactions:

      //carol buys a red hat. We need an order id to be able to
      //save OrderItem, which has an orderId column.
      let tx=yield pers.getTransaction();
      order=new pers.m.Order();
      order.customerId=carol.id;
      order.dateTime=new Date();
      let saveResult=yield pers.saveX(tx, order);
      assert(order.id>0);
      //out of tx ops shouldn't see it:
      let invisibleOrder=yield pers.loadById("Order", order.id);
      assert(invisibleOrder===null);

      let oi=new pers.m.OrderItem();
      oi.orderId=order.id; //we have an uncommitted id
      oi.productId=rh.id;
      yield pers.saveX(tx, oi);
      //carol pays, but we realize that ret hat became out of stock.
      yield tx.rollback();
      //make sure the connection is closed:
      yield tx.commit().then(function(){
        assert(false);
      }).catch(function(err){
        assert(err.toString().indexOf("Transaction is closed.")>-1);
      });

      //likewise:
      yield pers.saveX(tx, order).then(function(){
        assert(false);
      }).catch(function(err){
        assert(err.toString().indexOf("Transaction is closed.")>-1);
      });

      //again, this time succeed:
      tx=yield pers.getTransaction();
      delete order.id;
      yield pers.saveX(tx, order);
      delete oi.id;
      oi.orderId=order.id;
      yield pers.saveX(tx, oi);
      var comitResult=yield tx.commit();

      //check the results out of tx:
      let controlOrder=yield pers.loadById("Order", order.id, "*, orderItems.*");
      assert(controlOrder!=null);
      assert(controlOrder.id===order.id)
      assert(controlOrder.orderItems.length===1);
      assert(controlOrder.orderItems[0].productId===rh.id);


    /**************************************************************************/
    pers.destroy();
    console.log("done.");
  }
}).catch(function(err){
  console.log("err in 2.js: ", err);
  try{
    pers.destroy();
  }
  catch(err)
  {}
});
