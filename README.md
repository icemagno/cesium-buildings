Cesium plugin to add textured building from a WFS source
========================================================

Cesium-buildings
----------------

![Cesium-buildings](http://i.vimeocdn.com/video/510696668_200x150.jpg)

This Cesium plugin allows you to visualize textured 3D objects coming from a WFS server.

It is currently mainly used to display buildings.

It currently features :

- Tiling
- Textures
- Object Picking

You can see a demo video here : https://vimeo.com/119770865

Global Architecture
-------------------

The setup we use to serve 3D buildings to Cesium is the following one :
- PostGIS 2.0+ database with 3D and SFCGAL support
- 3DCityDB importer to read CityGML and import it to the database 
- Latest TinyOWS to provide WFS web service for PostGIS data
- Static file served by Apache for textures
- (Optional) MapServer WMS web services for background layer

You can follow our workshop if you want to setup the server infrastructure :

https://github.com/Oslandia/workshop-3d

WFS 3D format
-------------

Here will soon be the description of the 3D format expected from the WFS server.

Roadmap
-------

- [ ] WFS format documentation
- [ ] Improve performances
- [ ] Object packing
- [ ] LOD for geometries
- [ ] LOD for textures (with IIP server)

Contributors
------------

- Vincent Mora <vincent.mora@oslandia.com> (Oslandia)

Thank you
---------

Thanks to Grand Lyon for releasing their 3D models as open data.

Licence
-------

This work is released under the LGPL v2.1 or later licence. See LICENSE file.

