module.exports = {

  dbConfigs:{

    sqlite3: {
      database: "/path/to/a/PersTest.sqlite"
    }
    ,
    mysql: {
      user: "username",
      password: "password",
      host: "localhost",
      database: "PersTest",
    }
    ,
    postgres: {
      user: "postgres",
      password: "password",
      host: "localhost",
      database: "PersTest",
    }
  },

  applyTestsTo: [ //comment out lines to disable tests.
    "sqlite3",
    "mysql",
    "postgres",
  ]
}
