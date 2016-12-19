"use strict";
var co=require("co");
var Persistanz=require("../lib/Persistanz.js");
var prepare=require("./attic/prepare.js");
var assert=require("assert");
var conf=require("./conf.js");

var pers=null;

co(function*(){
  for (var adapterName of conf.applyTestsTo)
  {
    var dbConf=conf.dbConfigs[adapterName];
    dbConf.adapter=adapterName;
    console.log("Running 1.js tests for "+adapterName);
    yield prepare.createTestDatabase(dbConf);
    pers=new Persistanz(dbConf);
    yield pers.create();
    /**************************************************************************/

    //basic insert: customer 1
    let c=new pers.m.Customer();
    c.name="Ege Madrauauaua";
    let saveResult=yield pers.save(c);
    assert(saveResult.object.id>0);
    assert(c.id===saveResult.object.id);
    assert(saveResult.lastInsertId===c.id);
    assert(saveResult.command==="insert");
    assert(saveResult.status==="saved");
    //update:
    c.name="Ege Madra";
    let updateResult=yield c.save();
    assert(updateResult.status==="saved");
    assert(updateResult.command==="update");
    assert(c.id===saveResult.lastInsertId);
    assert(updateResult.lastInsertId===null);

    //no update:
    c.id=7777;
    saveResult=yield c.save();
    assert(saveResult.status==="not-saved");

    //save as: customer 2
    saveResult=yield pers.m.Customer.save({"name": "Carlo Angelotti"});
    assert(saveResult.status==="saved");

    //insert: customer 3
    saveResult=yield c.insert();
    assert(saveResult.status==="saved");
    assert(saveResult.lastInsertId===7777);
    assert(c.id===7777);

    //save as on pers Order 1
    saveResult=yield pers.saveAs({customerId: 7777, dateTime: new Date()}, "Order");
    assert(saveResult.status==="saved");
    assert(saveResult.lastInsertId>0);

    //no insert on already existing:
    yield pers.insertAs({id:7777, name:"Poor Guy"}, "Customer").then(function(){
      assert(false);
    }).catch(function(){
      assert(true);
    });

    //create an object for deleting
    saveResult=yield pers.m.Customer.save({name: "delete 1"});
    var delResult=yield pers.deleteById("Customer", saveResult.lastInsertId);
    assert(delResult.status==="deleted");

    //not again:
    delResult=yield pers.deleteById("Customer", saveResult.lastInsertId);
    assert(delResult.status==="not-deleted");

    //delete object  method
    saveResult=yield pers.m.Customer.save({name: "delete 1"});
    delResult=yield pers.deleteObject(saveResult.object);
    assert(delResult.status==="deleted");

    //basic query methods to verify:
    //at this point we have 3 customers, one is carlo, others are Ege Madra
    let customers=yield pers.q().f("Customer").s("*").exec();

    assert(Array.isArray(customers));
    assert(customers.length===3);

    //load by id (not existing)
    let customer=yield pers.loadById("Customer", 95922, "*");
    assert(customer===null)

    //existing
    customer=yield pers.loadById("Customer", 7777);
    assert(customer.name==="Ege Madra");

    //clauses:
    customers=yield pers.q().f("Customer").w("{name} like ?", "%adr%").exec();
    assert(customers.length===2);
    assert(customers[0] instanceof pers.m.Customer);
    assert(customers[0].name==="Ege Madra");

    //find 1 Ege Madra out of 2
    let customersResult=yield pers.q()
      .f("Customer")
      .s("name")
      .w("{name} = ?", "Ege Madra")
      .l(1)
      .calc() //return nr of rows without limit
      .exec();


    assert("objects" in customersResult);
    assert("count" in customersResult);
    assert(customersResult.objects.length===1);
    assert(customersResult.count==2); //no triple =, postgres returns a string.
    assert(customersResult.objects[0].name==="Ege Madra");

    var sql=pers.m.Customer.q()
      .selectAlias("{name} as nomo")
      .s("id")
      .index("id")
      .w("{name} like '%a%'")
      .o("{name} asc, {id} desc") //Carlo comes before Ege, 7777 ege first
      .g("{id}") //meaningless as all of them are different, but we can use
      .l(2).build().getQuery();


    //indexed, select alias, order by
    customersResult=yield pers.m.Customer.q()
      .selectAlias("{name} as nomo")
      .s("id")
      .index("id")
      .w("{name} like '%a%'")
      .o("{name} asc, {id} desc") //Carlo comes before Ege, 7777 ege first
      .g("{id}") //meaningless as all of them are different, but we can use
      .l(2)
      .exec();

    assert(customersResult instanceof Map);
    assert(customersResult.size===2);
    assert(customersResult.get(7777) instanceof pers.m.Customer);
    assert(customersResult.get(7777).nomo==="Ege Madra");
    assert(customersResult.get(7777).name===undefined);
    //respecting the order by clause despite index?
    assert(Array.from(customersResult.values())[0].nomo==="Carlo Angelotti");

    //add a superficial calc to it and stream results
    let endCalled=false, errorCalled=false, objectCalled=false, count=null;
    customersResult=yield pers.m.Customer.q()
      .selectAlias("{name} as nomo")
      .s("id")
      .index("id")
      .w("{name} like '%a%'")
      .o("{name} asc, {id} desc") //Carlo comes before Ege, 7777 ege first
      .g("{id}")
      .l(2)
      .calc()
      .on('object', function(object, index){
        objectCalled=true;
        if (index===7777)
          assert(object.nomo==="Ege Madra");
        else
          assert(object.nomo==="Carlo Angelotti");
      })
      .on("calc", function(totalRows){
        count=totalRows;
      })
      .on("end", function(){
        endCalled=true;
      })
      .on("error", function(){
        errorCalled=true;
      })
      .exec();

    assert("count" in customersResult);
    assert("objects" in customersResult)
    assert(customersResult.objects===true);
    assert(customersResult.count==3); //postgres returns string.
    assert(endCalled===true);
    assert(objectCalled===true);
    assert(errorCalled===false);

    //distinct:
    customersResult=yield pers.q().f("Customer").s("name").distinct().exec();
    assert(customersResult.length===2);

    //adapter interface:
    assert(typeof pers.adapter.connect==="function");
    assert(typeof pers.adapter.close==="function");
    assert(typeof pers.adapter.exec==="function");
    assert(typeof pers.adapter.query==="function");
    assert(typeof pers.adapter.begin==="function");
    assert(typeof pers.adapter.commit==="function");
    assert(typeof pers.adapter.rollback==="function");
    assert(typeof pers.adapter.acquire==="function");
    assert(typeof pers.adapter.release==="function");
    assert(typeof pers.adapter.destroy==="function");

    var escTableName=pers.escapeId("Customer"); //postgres lowercases it, prevent.
    var adapterResultSet=yield pers.adapter.query('select * from '+escTableName);
    for (var row of adapterResultSet)
      if (row.id==7777)
        assert(row.name==="Ege Madra");

    //lowest level, direct connection interface:
    var client=yield pers.adapter.acquire(); //instance of adapter from pool.
    assert(client.connection!=null);

    if (client.name==="sqlite3")
    {
      client.connection.all("select * from Customer where id=?", [7777], function(err, rows){
        assert(rows[0].name=="Ege Madra");
        client.release(); //sqlite3 is poolless, so the connection is destroyed.
      });
    }
    else if (client.name==="mysql")
    {
      client.connection.query("select * from Customer where id=?", [7777], function (err, rows, columns){
        assert(rows[0].name=="Ege Madra");
        client.release(); //return to the pool.
      });
    }
    else if (client.name==="postgres")
    {
      client.connection.query('select * from "Customer" where id=$1', [7777], function (err, result){
        assert(result.rows[0].name=="Ege Madra");
        client.release(); //return to the pool.
      });
    }

    pers.destroy();
    console.log("done.");
  }
}).catch(function(err){
  console.log("err in 1.js: ", err);
  console.log(err.stack);
  try{
    pers.destroy();
  }
  catch(err)
  {}
});
