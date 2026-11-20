import numpy as np, tifffile
y,x=np.mgrid[0:2048,0:2048]
a=((x*7+y*13)%4000+100).astype(np.uint16)
b=((x*3+y*5)%3000+50).astype(np.uint16)
data=np.stack([a,b])
with tifffile.TiffWriter('img/big.ome.tif', ome=True) as t:
    opts=dict(tile=(256,256), compression='zlib', photometric='minisblack')
    t.write(data, subifds=2, metadata={'axes':'CYX','PhysicalSizeX':0.5,'PhysicalSizeY':0.5,'Channel':{'Name':['Alpha','Beta']}}, **opts)
    t.write(data[:, ::2, ::2], subfiletype=1, **opts)
    t.write(data[:, ::4, ::4], subfiletype=1, **opts)
print('ok')
