"use strict";
const Persistanz = require("../lib/Persistanz");

const options = {
  adapter: "mysql2",
  host: "127.0.0.1",
  database: "",
  user: "root",
  password: "",
};

(async function () {

  const pers = new Persistanz(options);
  await pers.create();
  await pers.destroy();
    
})();
