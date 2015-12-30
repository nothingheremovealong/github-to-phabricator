"use strict";

var async = require("async");

var oldWaterfall = async.waterfall;

async.waterfall = function(tasks, callback) {
  oldWaterfall(tasks, function() {
    if (arguments[0] === 'break'){
      arguments[0] = null;
    }
    callback.apply(null, arguments);
  });
}

async.break = function() {
  var args = Array.prototype.slice.call(arguments);
  var callback = args.shift();
  args.unshift('break');
  callback.apply(null, args);
};

module.exports = async;
