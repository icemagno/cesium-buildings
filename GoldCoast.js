global.CESIUM_BASE_URL = 'build/Cesium/';

var Cesium = {};
Cesium.CesiumTerrainProvider = require('terriajs-cesium/Source/Core/CesiumTerrainProvider');
Cesium.ColorGeometryInstanceAttribute = require('terriajs-cesium/Source/Core/ColorGeometryInstanceAttribute');
Cesium.Color = require('terriajs-cesium/Source/Core/Color');
Cesium.defined = require('terriajs-cesium/Source/Core/defined');
Cesium.Entity = require('terriajs-cesium/Source/DataSources/Entity');
Cesium.OpenStreetMapImageryProvider = require('terriajs-cesium/Source/Scene/OpenStreetMapImageryProvider');
Cesium.QuadtreePrimitive = require('terriajs-cesium/Source/Scene/QuadtreePrimitive');
Cesium.Rectangle = require('terriajs-cesium/Source/Core/Rectangle');
Cesium.ScreenSpaceEventHandler = require('terriajs-cesium/Source/Core/ScreenSpaceEventHandler');
Cesium.ScreenSpaceEventType = require('terriajs-cesium/Source/Core/ScreenSpaceEventType');
Cesium.Viewer = require('terriajs-cesium/Source/Widgets/Viewer/Viewer');

var WfsTileProvider = require('./lib/WfsTileProvider');

var viewer = new Cesium.Viewer('cesiumContainer'/*, {baseLayerPicker : false, scene3DOnly : true}*/);


// terrain
viewer.scene.globe.depthTestAgainstTerrain = true;
var cesiumTerrainProviderMeshes = new Cesium.CesiumTerrainProvider({
    url : '//cesiumjs.org/stk-terrain/tilesets/world/tiles'
});
viewer.terrainProvider = cesiumTerrainProviderMeshes;

// Tiler
var tileProvider = new WfsTileProvider({
                       url: 'http://37.187.164.233/cgi-bin/tinyows_australia',
                       layerName: 'tows:goldcoast'
                       });
viewer.scene.primitives.add(new Cesium.QuadtreePrimitive({tileProvider : tileProvider}));

var cameraView = new Cesium.Rectangle.fromDegrees(153.179104, -27.693205, 153.551171, -28.217537);
viewer.camera.viewRectangle(cameraView);

function saveStats(){
    urlContent = "data:application/octet-stream," + encodeURIComponent(JSON.stringify(WfsTileProvider.STATS));
    window.open(urlContent, 'Records');
}

var thematicOn = false;
    function toggleThematic(){
        if (!thematicOn){
            tileProvider.setColorFunction(function(properties){
                return (properties.tileX + properties.tileY) % 2 ? new Cesium.Color(0.5 + 0.25 * (properties.gid % 10) / 10.0,0.5 - 0.25 * (properties.gid % 10) / 10.0,0,1.0) :
                                                                   new Cesium.Color(0,0.5 + 0.25 * (properties.gid % 10) / 10.0,0.5 - 0.25 * (properties.gid % 10) / 10.0,1.0);
            });
            thematicOn = true;
        } else {
            tileProvider.setColorFunction(function(properties){
                return  new Cesium.Color(1.0,1.0,1.0,1.0);
            });
            thematicOn = false;
        }
    }

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
    }

    var handler;
    var restore;
    var entity = new Cesium.Entity({name : 'Title to put in the infobox'});
    function toggleHighlight(){
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
                        viewer.selectedEntity = entity;

                        restore.attributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(new Cesium.Color(1., 1., 0.));
                    }

                } else {
                    restoreColor();
                    viewer.selectedEntity = undefined;
                }
                pickingInProgress = undefined;
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        } else {
            restoreColor();
            viewer.selectedEntity = noEntity;
            handler.destroy();
            handler = undefined;
        }
    }
global.toggleThematic = toggleThematic;
global.toggleHighlight = toggleHighlight;
global.toggleOsm = toggleOsm;
global.saveStats = saveStats;
