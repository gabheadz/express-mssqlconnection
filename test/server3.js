var http = require('http');
var express = require('express');
var co = require('co');
var sql = require('co-mssql');
var connection = require('../src/express-mssqlconnection');
var assert = require('assert');

var app;
var server;

describe('Test suite for express-mssqlconnection - Request Mode', function() {
  before(function(done) {
    
    co(function * () {
      app = express();

      app.use(
          connection({
              user: 'sa',
              password: 'brgkw39q8j',
              server: '127.0.0.1',
              database: 'tempdb',
              pool: {
                max: 2,
                min: 1,
                idleTimeoutMillis: 30000
              },
              options: {
                useUTC : false,
                appName  : 'TestApp_Request'
              }
        },'request')    
      );

      app.get('/api/test', function(req, res) {
        console.log('\t/api/test invoked.');
        req.getConnection(function(err, connection) {
          
          if (err) {
            console.log('\terror obtaining connection', err);
            return;
          }
          
          co( function * () {
            try {
              var response = { "count": -1, "error": null };
              var request = new sql.Request(connection);
              var recordset = yield request.query('SELECT count(1) as NumOfObjects ' +
                'FROM tempdb.sys.all_objects ');
              response.count = recordset[0].NumOfObjects;
              res.status(200).json(response); 
            }
            catch(err) {
              console.log('\terror invoking /api/test', err);
              var response = { "error": err };
              res.status(500).json(response);  
            }
          });
        });  
      });    

      server = app.listen('8083', function(){
        console.log('\tServer listening...');
        done();
      });

    });
  });
  
  it('Request #1', function(done) {
    console.log('\tinvoking /api/test 1st time...');
		co(function * () {
      var data = "";
      http.get('http://localhost:8083/api/test', function(res) {
        res.on('data', function(d) {
          data += d;
        });
        res.on('end', function() {
          var jsonObject = JSON.parse(data);
          assert( jsonObject.count > 0, 'Object count in db object is not OK' );
          done();
        });
        }).on('error', function(e) {
          console.log('\terror invoking /api/test', e);
        });    
		});
	});  
  
  it('Request #2', function(done) {
    console.log('\tinvoking /api/test 2nd time...');
		co(function * () {
      var data = "";
      http.get('http://localhost:8083/api/test', function(res) {
        res.on('data', function(d) {
          data += d;
        });
        res.on('end', function() {
          var jsonObject = JSON.parse(data);
          assert( jsonObject.count > 0, 'Object count in db object is not OK' );
          done();
        });
        }).on('error', function(e) {
          console.log('\terror invoking /api/test', e);
        });    
		});
	});  
  
  after(function(done) {
      server.close();
			done();
	});  
  
})