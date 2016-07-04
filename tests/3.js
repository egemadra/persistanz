"use strict";
var pc=require("../lib/common.js").pc;
var co=require("co");
var Persistanz=require("../lib/Persistanz.js");
var prepare=require("./attic/prepare.js");
var assert=require("assert");
var conf=require("./conf.js");

var pers=null;

function Customera(){
    this.numberOfHooksCalled=0;
}

Customera.prototype.beforeSave=function(tx, command){
  this.numberOfHooksCalled++;
  //let's not allow saving customers without a name.
  if (this.name==undefined || this.name.trim()==="")
    return Promise.resolve(false);

  return Promise.resolve(true);
}

//example with callback
Customera.prototype.beforeDelete=function(tx, callback)
{
  this.numberOfHooksCalled++;
  //don't delete if the customer has orders.
  pers.m.Order.q()
    .sa("COUNT({id}) as count")
    .w("{customerId}=?", this.id)
    .exec()
    .then(function(result){
      callback(null, result.pop().count==0); //postgres makes them string
    });
}

//nothing to do. callback example.
Customera.prototype.afterSave=function(tx, command, callback)
{
  this.numberOfHooksCalled++;
  callback(null); //conform to the node style, first arg is err.
}

//nothing to do. promise example.
Customera.prototype.afterDelete=function(tx)
{
  this.numberOfHooksCalled++;
  return Promise.resolve();
}

let persConf={
  //extend: false,
  models:[
    {model: Customera, table: "Customer"},
  ]
}

co(function*(){
  for (var adapterName of conf.applyTestsTo)
  {
    var dbConf=conf.dbConfigs[adapterName];
    dbConf.adapter=adapterName;
    console.log("Running 3.js tests for "+adapterName);
    yield prepare.createTestDatabase(dbConf);
    pers=new Persistanz(dbConf, persConf);
    yield pers.create();
    /**************************************************************************/

    //test for hooks:
    let customer=new Customera();
    customer.name="";
    var saveResult=yield customer.save(); //1 (no afterSave)
    assert(saveResult.status==="cancelled");
    var saveResult=yield pers.save(customer); //2 (no afterSave)
    assert(saveResult.status==="cancelled");
    var customers=yield Customera.q().exec();
    assert(customers.length===0);

    //okay, give him a name:
    customer.name="Jon Snow";
    var saveResult=yield customer.save(); //3, //4 (before and after save)
    assert(saveResult.status==="saved");
    assert(customer.id>0);

    //create an order for john snow.
    var order=new pers.m.Order();
    order.customerId=customer.id;
    order.dateTime=new Date();
    yield order.save();
    assert(order.id>0);

    //attempt to delete john:
    var delResult=yield customer.delete(); //5 (no after delete)
    assert(delResult.status==="cancelled");

    //delete the order and try again:
    var u=yield pers.deleteObject(order);
    delResult=yield customer.delete(); //6, //7 (before and after delete)
    assert(delResult.status==="deleted");
    //make sure all hooks are called:
    assert(customer.numberOfHooksCalled===7);

    /**************************************************************************/
    pers.destroy();
    console.log("done.");
  }
}).catch(function(err){
  console.log("err in 3.js: ", err);
  try{
    pers.destroy();
  }
  catch(err)
  {}
});
