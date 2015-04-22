
/**
 * Module dependencies.
 */

var cluster = require('cluster')
  , numCPUs = require('os').cpus().length
  , express = require('express')
  , Sequelize = require('sequelize')
  , mongoose = require('mongoose')
  , conn = mongoose.connect('mongodb://localhost/hello_world')
  , async = require('async');

var Schema = mongoose.Schema
  , ObjectId = Schema.ObjectId;

var WorldSchema = new mongoose.Schema({
    id          : Number,
    randomNumber: Number
  }, {
    collection: 'world'
  }),
  MWorld = conn.model('World', WorldSchema);

var sequelize = new Sequelize('hello_world', 'benchmarkdbuser', 'benchmarkdbpass', {
  host: '127.0.0.1',
  dialect: 'mysql',
  logging: false,
  pool: {
    max: 5000,
    min: 0,
    idle: 5000
  }
});

var World = sequelize.define('World', {
  id: {
    type: 'Sequelize.INTEGER'
  },
  randomNumber: {
    type: 'Sequelize.INTEGER'
  }
}, {
  timestamps: false,
  freezeTableName: true
});
var Fortune = sequelize.define('Fortune', {
  id: {
    type: 'Sequelize.INTEGER'
  },
  message: {
    type: 'Sequelize.STRING'
  }
}, {
  timestamps: false,
  freezeTableName: true
});

if (cluster.isMaster) {
  // Fork workers.
  for (var i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', function(worker, code, signal) {
    console.log('worker ' + worker.pid + ' died');
  });
} else {
  var app = module.exports = express();

  // Configuration
  app.configure(function(){
    app.use(express.bodyParser());
    app.use(express.methodOverride());
    app.use(app.router);

    app.set('view engine', 'jade');
    app.set('views', __dirname + '/views');
  });

  app.configure('development', function() {
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
  });

  app.configure('production', function() {
    app.use(express.errorHandler());
  });

  // Routes

  app.get('/json', function(req, res) {
    res.send({ message: 'Hello, World!' })
  });
  
  app.get('/mongoose', function(req, res) {
    var queries = req.query.queries || 1,
        queryFunctions = [];

    queries = Math.min(Math.max(queries, 1), 500);

    for (var i = 1; i <= queries; i++ ) {
      queryFunctions.push(function(callback) {
        MWorld.findOne({ id: (Math.floor(Math.random() * 10000) + 1) }).exec(callback);
      });
    }

    async.parallel(queryFunctions, function(err, results) {
      if (!req.query.queries) {
        results = results[0];
      }
      res.send(results);
    });
  });

  app.get('/mysql-orm', function(req, res) {    
    var queries = isNaN(req.query.queries) ? 1 : parseInt(req.query.queries, 10)
      , queryFunctions = [];

    queries = Math.min(Math.max(queries, 1), 500);

    for (var i = 1; i <= queries; i++ ) {
      queryFunctions.push(function(callback) {
        World.findOne({
          where: {
            id: Math.floor(Math.random() * 10000) + 1}
          }
        ).complete(callback);
      });
    }

    async.parallel(queryFunctions, function(err, results) {
      if (!req.query.queries) {
        results = results[0];
      }
      res.send(results);
    });
  });

  app.get('/fortune', function(req, res) {
    if (windows) return res.send(501, 'Not supported on windows');
    
    Fortune.findAll().complete(function (err, fortunes) {
      var newFortune = {id: 0, message: "Additional fortune added at request time."};
      fortunes.push(newFortune);
      fortunes.sort(function (a, b) {
        return (a.message < b.message) ? -1 : 1;
      });

      res.render('fortunes', {fortunes: fortunes});
    });
  });

  app.get('/mongoose-update', function(req, res) {
    var queries = req.query.queries || 1
      , selectFunctions = [];

    queries = Math.min(queries, 500);

    for (var i = 1; i <= queries; i++ ) {
      selectFunctions.push(function(callback) {
        MWorld.findOne({ id: Math.floor(Math.random() * 10000) + 1 }).exec(callback);
      });
    }

    async.parallel(selectFunctions, function(err, worlds) {
      var updateFunctions = [];

      for (var i = 0; i < queries; i++) {
        (function(i){
          updateFunctions.push(function(callback){
            worlds[i].randomNumber = Math.ceil(Math.random() * 10000);
            MWorld.update({
              id: worlds[i]
            }, {
              randomNumber: worlds[i].randomNumber
            }, callback);
          });
        })(i);
      }

      async.parallel(updateFunctions, function(err, updates) {
        res.send(worlds);
      });
    });
  });

  app.get('/mysql-orm-update', function(req, res) {
    var queries = isNaN(req.params.queries) ? 1 : parseInt(req.params.queries, 10)
      , selectFunctions = [];

    queries = Math.min(queries, 500);

    for (var i = 1; i <= queries; i++ ) {
      selectFunctions.push(function(callback) {
        World.findOne({
          where: {
            id: Math.floor(Math.random() * 10000) + 1}
          }
        ).complete(callback);
      });
    }

    async.parallel(selectFunctions, function(err, worlds) {
      var updateFunctions = [];

      for (var i = 0; i < queries; i++) {
        (function(i){
          updateFunctions.push(function(callback){
            worlds[i].randomNumber = Math.ceil(Math.random() * 10000);
            worlds[i].save().complete(callback);
          });
        })(i);
      }

      async.parallel(updateFunctions, function(err, updates) {
        res.send(worlds);
      });
    });  
 
  });

  app.listen(8080);
}
