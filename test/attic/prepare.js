"use strict";
const fs = require("fs");
const co = require("co");
const helper = require("../../lib/helper.js");

module.exports = {
  createTestDatabase,
  loadConfig,
}

function loadConfig() {
  return 'TRAVIS' in process.env && 'CI' in process.env
    ? require(__dirname + "/../conf/travis-db-config.js")
    : require(__dirname + "/../conf/db-config.js");
}

function createTestDatabase(config)
{
  return co(function*(){
    switch(config.adapter)
    {
      case 'sqlite3':
        try {
          var r=fs.unlinkSync(config.database);
        }
        catch (err) {};
        var sqlite3 = require('sqlite3').verbose();
        var db = new sqlite3.Database(config.database);
        var sqls=fs.readFileSync(__dirname+"/sqlite3.sql", "utf8");
        yield helper.promisifyCall(db.exec, db, [sqls]);
        db.close();
        return;
      case 'mysql':
        var mysql=require('mysql');
        var db=config.database;
        var copyConf=JSON.parse(JSON.stringify(config));
        delete copyConf.database;
        copyConf.multipleStatements=true; //so that we can create the db in one go.
        var connection = mysql.createConnection(copyConf);
        yield helper.promisifyCall(connection.connect, connection);
        yield helper.promisifyCall(connection.query, connection, ["DROP DATABASE IF EXISTS `"+db+"`"]);
        yield helper.promisifyCall(connection.query, connection, ["CREATE DATABASE `"+db+"`"]);
        yield helper.promisifyCall(connection.changeUser, connection, [{database:db}]);
        var sqls=fs.readFileSync(__dirname+"/mysql.sql", "utf8");
        yield helper.promisifyCall(connection.query, connection, [sqls]);
        connection.end();
        return;
      case 'postgres':
        var pg=require('pg');
        var db=config.database;
        var copyConf=JSON.parse(JSON.stringify(config));
        delete copyConf.database;
        copyConf.database="template1";
        var client = new pg.Client(copyConf);
        yield helper.promisifyCall(client.connect, client);
        yield client.query('DROP DATABASE IF EXISTS "'+db+'"');
        yield client.query('CREATE DATABASE "'+db+'" ENCODING '+" 'UTF8'");
        client.end();
        client=new pg.Client(config);
        yield helper.promisifyCall(client.connect, client);
        var sqls=fs.readFileSync(__dirname+"/postgres.sql", "utf8");
        yield client.query(sqls);
        client.end();
        return;
    }
  }).catch(function(err){
    console.log("err in create test database: ", err);
  });
}

function parseDbUrl(connString)
{
  var parsed=require("url").parse(connString);
  var adapter=parsed.protocol.split(":")[0].trim().toLowerCase();
  var parts=parsed.auth!=undefined ? parsed.auth.split(':') : [null, null];

  return {
    adapter,
    host: parsed.host,
    port: parsed.port ? parseInt(parsed.port) : undefined,
    user: parts[0],
    password: parts[1],
    database: adapter==="sqlite3" ? parsed.pathname : parsed.pathname.substring(1),
  };
}
