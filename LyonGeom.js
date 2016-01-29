window.CESIUM_BASE_URL = './';
require('./thirdparty/cesium/Cesium.js');
require('./thirdparty/cesium/Widgets/widgets.css');
var Cesium = window.Cesium;

var TileProvider = require('./js/TileProvider.js');
var Semantics = require('./js/Semantics.js');

var viewer = new Cesium.Viewer('cesiumContainer', {scene3DOnly : true});

var test = new Semantics({
    url: "http://localhost/server",
    layerName: "lyon_lod2"
});

var texture_dir = "../w/textures/"

// terrain
viewer.scene.globe.depthTestAgainstTerrain = true;
var cesiumTerrainProviderMeshes = new Cesium.CesiumTerrainProvider({
    url : '//assets.agi.com/stk-terrain/world'
});
viewer.terrainProvider = cesiumTerrainProviderMeshes;

// Tiler
var rectangle = Cesium.Rectangle.fromDegrees(4.770386,45.716615,4.899764,45.789917);
var tileProvider = new TileProvider({
                       url: 'http://localhost/server',
                       layerName: 'lyon_lod2', 
                       loadDistance: 3,
                       zOffset: 55,
                       properties: ["height"]
                       });
viewer.scene.primitives.add(new Cesium.QuadtreePrimitive({tileProvider : tileProvider, additive : true}));

viewer.camera.setView({destination:rectangle});

// Imagery
var provider = new Cesium.WebMapServiceImageryProvider({
    enablePickFeatures : false,
    url: 'https://download.data.grandlyon.com/wms/grandlyon',
    layers : 'PlanGuide_VueEnsemble_625cm_CC46'//'Ortho2009_vue_ensemble_16cm_CC46'
});
viewer.imageryLayers.addImageryProvider(provider);

var semantic = new Semantics({
    url: "http://localhost/server",
    layerName: "lyon_lod2"
});

function saveStats(){
    urlContent = "data:application/octet-stream," + encodeURIComponent(JSON.stringify(WfsTileProvider.STATS));
    window.open(urlContent, 'Records');
};

var thematicOn = false;
function toggleThematic(){
    /*if (!thematicOn){
        tileProvider.setColorFunction(function(properties){
          return new Cesium.Color(0.5, 0.2 * properties.tileZ, 0.0, 1.0);
        });
        thematicOn = true;
    } else {
        tileProvider.setColorFunction(function(properties){
            return  new Cesium.Color(1.0,1.0,1.0,1.0);
        });
        thematicOn = false;
    }*/
    if (!thematicOn){
        tileProvider.setColorFunction(function(properties){
          if(properties["height"] === undefined || properties["height"] === "pending") {
              return new Cesium.Color(0.5, 0.5, 0.5, 1.0);
          } else {
              var h = properties["height"];
              return new Cesium.Color(0.2, 0.2, 0.2 + 0.8 * 0.01 * h, 1.0);
          }
          return new Cesium.Color(0.5, 0.2 * properties.tileZ, 0.0, 1.0);
        });
        thematicOn = true;
    } else {
        tileProvider.setColorFunction(function(properties){
            return  new Cesium.Color(1.0,1.0,1.0,1.0);
        });
        thematicOn = false;
    }
};

var osmLayer;
function toggleOsm(){
    if (!Cesium.defined(osmLayer)){
        osmLayer = viewer.scene.imageryLayers.addImageryProvider(
            new Cesium.OpenStreetMapImageryProvider({
              url : '//a.tile.openstreetmap.org/'
              }));
    } else {
        viewer.scene.imageryLayers.remove(osmLayer);
        osmLayer = undefined;
    }
};

var handler;
var entity = new Cesium.Entity({name : 'Title to put in the infobox'});
function toggleHighlight(){
    var restore;
    function restoreColor(){
        if(restore) {
            restore.attributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(restore.primitive.properties[restore.id].color);
        }
    }
    if (!Cesium.defined(handler)){
        // If the mouse is over a feature, change its color to yellow
        var pickingInProgress = false;
        handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction(function(movement) {
            if (pickingInProgress) return;
            pickingInProgress = true;
            var pickedObject = viewer.scene.pick(movement.endPosition);
            if (Cesium.defined(pickedObject) 
                && Cesium.defined(pickedObject.primitive) 
                && Cesium.defined(pickedObject.primitive.properties) ) {

                if (!Cesium.defined(restore) || pickedObject.primitive != restore.primitive || pickedObject.primitive.id != restore.id){
                    restoreColor();
                    restore = {
                        primitive:pickedObject.primitive, 
                        id:pickedObject.id,
                        attributes:pickedObject.primitive.getGeometryInstanceAttributes(pickedObject.id)
                    };
                    entity.description = {
                        getValue : function() {
                            var properties = restore.primitive.properties[restore.id];
                            var string = "<table>";
                            for(var p in properties) {
                              string += "<tr> <th>" + p + "</th><th>" + properties[p] + "</th></tr>";
                            }
                            string += "</table>"
                            return string;
                        }
                    };

                    restore.attributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(new Cesium.Color(1., 1., 0.));

                    var prop = restore.primitive.properties[restore.id];
                    var addProperty = function(data) {
                        prop["height"] = data[0]["height"];
                        tileProvider.setColorFunction(tileProvider._colorFunction); // refresh colors, bourrin
                    }
                    if(restore.primitive.properties[restore.id]["height"] === undefined) {
                        prop["height"] = "pending";
                        semantic.getAttributes([restore.id], ["height"], addProperty);
                    }

                    viewer.selectedEntity = entity;
                }

            } else {
                restoreColor();
                viewer.selectedEntity = undefined;
            }
            pickingInProgress = undefined;
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    } else {
        restoreColor();
        viewer.selectedEntity = undefined;
        handler.destroy();
        handler = undefined;
    }
};

global.toggleThematic = toggleThematic;
global.toggleHighlight = toggleHighlight;
global.toggleOsm = toggleOsm;
global.saveStats = saveStats;