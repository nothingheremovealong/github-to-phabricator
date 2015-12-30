"use strict";

var request = require('request');

function Conduit(opts) {
  this.client = opts.client || 'conduit';
  this.logger = opts.logger || {
    log: function silent () { }
  };

  this.api = opts.api;
  this.token = opts.token;
}

Conduit.conduitError = function conduitError (data) {
  var err = new Error(data.error_info);
  err.code = data.error_code;
  return err;
};

Conduit.serverError = function serverError (response) {
  var err = new Error(response.body &&
    response.body.toString());
  err.code = response.statusCode;
  return err;
};

Conduit.prototype.requestWithToken = function requestWithToken (route, params, cb) {
  params['api.token'] = this.token;

  var req = request.get(this.api + route, {
    json: true,
    qs: params,
  }, cb);

  this.logger.log('GET %s', this.api + route);

  return req;
};

Conduit.prototype.exec = function exec (route, params, cb) {
  var logger = this.logger;
  var req = this.requestWithToken.call(this, route, params || {}, processResponse);

  function processResponse(error, response, data) {
    if (error) return cb(error, null);

    if (response.statusCode >= 400) {
      return cb(Conduit.serverError(response), null);
    }

    if (data.result) {
      data = data.result;
    }

    if (data.error_info) {
      return cb(Conduit.conduitError(data), null);
    }

    logger.log('%s responded with %s',
      req.href, JSON.stringify(data));

    cb(null, data);
  }

  return req;
};

module.exports = Conduit;
