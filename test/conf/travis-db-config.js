module.exports = {

  dbConfigs:{

    sqlite3: {
      database: "/tmp/PersTest.sqlite"
    },

    mysql: {
      user: "root",
      password: "",
      host: "127.0.0.1",
      database: "PersTest",
    },

    postgres: {
      user: "postgres",
      password: "",
      host: "localhost",
      database: "PersTest",
    }
  },


  applyTestsTo:[
    "mysql",
    "postgres",
    "sqlite3",
  ]
}
