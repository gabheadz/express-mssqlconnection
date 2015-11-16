var poolModule = require('generic-pool');
var co = require('co'); 
var sql = require('co-mssql'); 

var _dbConfig,
    _connection, // This is used as a singleton in a single connection strategy
    _pool; // Pool singleton

/**
* Handling connection disconnects
*/
var handleDisconnect = function() {
    co(function * () {
      _connection = new sql.Connection(_dbConfig)
      .on('connect', function() {
        //console.log('Connection restored');
      })
      .on('close', function() {
        //console.log('Connection closed');
      })
      .on('error', function(err) {
        //error codes not worth re-trying connection
        if (err && (err.code == 'ELOGIN' || err.code == 'EDRIVER' || err.code == 'EALREADYCONNECTED'
            || err.code == 'EALREADYCONNECTING') ) {
          console.log('error when connecting to db:', err);
          throw err;
        } else {
          setTimeout(handleDisconnect, 2000);
        } 
      });
      yield _connection.connect();
    }).then(function (value) {
      //console.log('Connection reopened');
    }, function(err2) {
        //error codes not worth re-trying connection
        if (err2 && (err2.code == 'ELOGIN' || err2.code == 'EDRIVER' || err2.code == 'EALREADYCONNECTED'
            || err2.code == 'EALREADYCONNECTING') ) {
          console.log('error when connecting to db:', err2);
          throw err2;
        } else {
          setTimeout(handleDisconnect, 2000);
        } 
    });  
}

/**
 * Returns a middleware that handles db connections
 *
 * @param {Object} dbConfig - db configuration
 * @param {String} o undefined - connection strategy (single, pool o request) 
 *                  strategy is single by default
 * @return {Function}
 * @api public
 */
module.exports = function (dbConfig, strategy) {

    if (null == dbConfig) throw new Error('Missing dbConfig module param!');
    if (null == strategy) strategy = 'single';


    // Setting _dbConfig ref
    _dbConfig = dbConfig;

    // Configuring strategies
    switch (strategy) {
        case 'single':
            // Creating single connection instance
            co(function * () {
              _connection = new sql.Connection(_dbConfig)
              .on('connect', function() {
                console.log('Connection created');
              })
              .on('close', function() {
                console.log('Connection closed');
              })
              .on('error', function(err) {
                console.log('error when connecting to db:', err);
                setTimeout(handleDisconnect, 2000);
              });
              return _connection;
            }).then(function (value) {
              //console.log('Connection opened');
            }, function(err) {
              console.log('error when connecting to db:', err);
              setTimeout(handleDisconnect, 2000);
            });

            break;
        case 'pool':
              _pool = poolModule.Pool({
                  name     : 'ComiteDB',
                  create   : function(callback) {
                    co(function* () {
                      var c = new sql.Connection(_dbConfig)
                        .on('connect', function() {
                          //console.log('Connection created');
                        })
                        .on('close', function() {
                          //console.log('Connection closed');
                        })
                        .on('error', function(err) {
                          console.log(err.stack);
                        });
                      yield c.connect(); 
                      return c;
                    }).then(function (value) {
                      callback(null, value);
                    }, function (err) {
                      console.error(err.stack);
                    });
                  },
                  destroy  : function(client) { client.close(); },
                  validate : function(client) {
                    return client.connected;
                  },
                  max      : 10,
                  // optional. if you set this, make sure to drain() (see step 3)
                  min      : 1,
                  // specifies how long a resource can stay idle in pool before being removed
                  idleTimeoutMillis : 300000,
                   // if true, logs via console.log - can also be a function
                  log : false
              });
            break;
        case 'request':
            // Nothing at this point to be done
            break;
        default:
            throw new Error('Not supported connection strategy!');
    }

    return function (req, res, next) {
      var poolConnection,
        requestConnection;

      switch (strategy) {
        case 'single':
          // getConnection will return singleton connection
          req.getConnection = function (callback) {
              co(function * () {
                if (!_connection.connected)
                  yield _connection.connect();
              }).then( function (value) {
                callback(null, _connection);                
              })
          }
          break;
          case 'pool':
            req.getConnection = function(callback) {
                _pool.acquire(function(err, client) {
                    if (err) {
                        console.log('Error acquiring object from pool');
                        console.log(err);
                    }
                    else {
                        poolConnection = client;
                        callback(null, poolConnection);
                    }  
                });
            }
            break;
          case 'request':
            // getConnection creates new connection per request
            req.getConnection = function (callback) {
              co(function * () {
                requestConnection = new sql.Connection(_dbConfig);
                requestConnection.on('connect', function() {
                  //console.log('Request Connection created');
                });
                requestConnection.on('close', function() {
                  //console.log('Request Connection closed');
                });
                requestConnection.on('error', function(err) {
                  console.error(err.stack);
                });
                yield requestConnection.connect();
              }).then(function (value) {
                callback(null, requestConnection); 
              }, function(err) {
                console.error(err.stack);
              });	
            }

            break;
        }

        var end = res.end;
        res.end = function (data, encoding) {

          // Ending request connection if available
          if (requestConnection) {
            requestConnection.close();
            requestConnection = null;
          }

          // Releasing pool connection if available
          if (poolConnection) { 
            _pool.release(poolConnection);
          }

          res.end = end;
          res.end(data, encoding);
        }

        next();
    }
      
}
