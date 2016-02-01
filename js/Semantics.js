/**
 * Retrieves semantics from an OGC service
 *
 * @param options.url: the service's url
 * @param options.layerName: the name of the layer of interest
 * @param options.workerPool: the worker pool in which the requests will be queued
 */

var Semantics = function(options) {
	this._url = options.url;
	this._layer = options.layerName;
	this._workerPool = options.workerPool;
};

/**
 * Retrieves a list of attribute for the specified object
 *
 * @param gid: the identifier of the object
 * @param attributeName: a list of attributes to request
 * @param callback: the function that should be called when the request is completed
 */
Semantics.prototype.getAttributes = function(gid, attributesName, callback) {
	var attributesStr = "";
	for(var a in attributesName) {
		attributesStr += attributesName[a] + ",";
	}
	attributesStr = attributesStr.substring(0, attributesStr.length - 1);

	var that = this;
	var request = this._url + "?query=getAttribute&city=" + this._layer + "&gid=" + gid + "&attribute=" + attributesStr;
	this._workerPool.enqueueJob({request: request, worker: "simpleLoad"}, function(w) {
		var attributes = parseAttributes(w.data.message);
		that._workerPool.releaseWorker(w.data.workerId);
		callback(attributes);
	});
};

parseAttributes = function(data) {
	return JSON.parse(data);
};

module.exports = Semantics;