/* Miscellaneous function for 2D bboxes
 */

function covers(first, second){
    return first[0] <= second[0] && first[1] <= second[1] &&
           first[2] >= second[2] && first[3] >= second[3];
}

function intersects(first, second){
    return !(first[2] < second[0] || first[0] > second[2] ||
             first[3] < second[1] || first[0] > second[3]);
}

function onNorthOrEast(tileBBox, bbox){
    return (tileBBox[2] <= bbox[2] && bbox[0] <= tileBBox[2]) ||
           (tileBBox[3] <= bbox[3] && bbox[1] <= tileBBox[3]);
}

function onSouthOrWest(tileBBox, bbox){
    return (tileBBox[0] <= bbox[2] && bbox[0] <= tileBBox[0]) ||
           (tileBBox[1] <= bbox[3] && bbox[1] <= tileBBox[1]);
}

function inTile(tileBBox, geom){
    return intersects(tileBBox, geom) && !onSouthOrWest(tileBBox, geom);
}

function pointInTile(tileBBox, point){
    return (tileBBox[0] <= point[0] && point[0] < tileBBox[2] &&
            tileBBox[1] <= point[1] && point[1] < tileBBox[3])
}

