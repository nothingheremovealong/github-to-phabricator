"use strict";

var Conduit = require("./phabricator-conduit");
var async = require("async");

Conduit.Error = {
  NOTFOUND: {
    error_info: "Project not found.",
    error_code: 100
  }
};

Conduit.prototype.findProject = function(name, fncb) {
  if (!name) {
    fncb(Conduit.conduitError(Conduit.Error.NOTFOUND));
    return;
  }

  this.exec('project.query', { names: [name] }, function(err, result) {
    async.detect(result.data, function(item, condition) {
      condition(item.name == name);

    }, function(result) {
      if (!result) {
        fncb(Conduit.conduitError(Conduit.Error.NOTFOUND));
        return;
      }

      fncb(null, result.phid);
    });
  });
};

module.exports = Conduit;
