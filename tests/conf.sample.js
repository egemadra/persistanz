module.exports={

  dbConfigs:{

    sqlite3: {
      database: "/path/to/a/sqlite.db"
    }
    ,
    mysql: {
      user: "root",
      password: "",
      host: "localhost",
      database: "PersTest",
    }
    ,
    postgres: {
      user: "postgres",
      password: "somepassword",
      host: "localhost",
      database: "PersTest",
    }
  },

  applyTestsTo:[ //comment out lines to disable tests.
    "sqlite3",
    "mysql",
    "postgres",
  ]
}
