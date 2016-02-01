var createWfsGeometry = require("./createWfsGeometry");
var createglTFGeometry = require("./createglTFGeometry");
var simpleLoad = require("./simpleLoad");

onmessage = function(o) {
	var worker = undefined;
	if(o.data.worker === "createWfsGeometry") {
		worker = createWfsGeometry;
	} else if(o.data.worker === "createglTFGeometry") {
		worker = createglTFGeometry;
	} else if(o.data.worker === "simpleLoad") {
		worker = simpleLoad;
	}

	if(worker !== undefined) {
		worker(o);
	}
}