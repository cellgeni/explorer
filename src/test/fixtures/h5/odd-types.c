/* Writes odd-types.h5 for src/data/h5Structure.test.ts: HDF5 types h5wasm
 * cannot write (opaque, bitfield, array datatypes, external storage, an
 * opaque attribute). With the HDF5 C library:
 *   h5cc -o make odd-types.c && ./make odd-types.h5
 * h5dump agrees with the values the tests expect. */
#include <hdf5.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
int main(int argc, char **argv) {
  hid_t fapl = H5Pcreate(H5P_FILE_ACCESS);
  H5Pset_libver_bounds(fapl, H5F_LIBVER_V18, H5F_LIBVER_V110);
  hid_t f = H5Fcreate(argv[1], H5F_ACC_TRUNC, H5P_DEFAULT, fapl);
  hsize_t n3 = 3;
  hid_t s3 = H5Screate_simple(1, &n3, NULL);
  /* opaque: 3 elements of 8 bytes, bytes 100..123 */
  hid_t ot = H5Tcreate(H5T_OPAQUE, 8); H5Tset_tag(ot, "blob");
  uint8_t ob[24]; for (int i = 0; i < 24; i++) ob[i] = 100 + i;
  hid_t d = H5Dcreate2(f, "opaque", ot, s3, H5P_DEFAULT, H5P_DEFAULT, H5P_DEFAULT);
  H5Dwrite(d, ot, H5S_ALL, H5S_ALL, H5P_DEFAULT, ob); H5Dclose(d); H5Tclose(ot);
  /* bitfield16: 3 elements 0x0102, 0x0304, 0x0506 */
  uint16_t bf[3] = {0x0102, 0x0304, 0x0506};
  d = H5Dcreate2(f, "bitfield", H5T_STD_B16LE, s3, H5P_DEFAULT, H5P_DEFAULT, H5P_DEFAULT);
  H5Dwrite(d, H5T_STD_B16LE, H5S_ALL, H5S_ALL, H5P_DEFAULT, bf); H5Dclose(d);
  /* array dtype, 2 x 30 elements of int32[3]; element (r,c) = [3k, 3k+1, 3k+2] with k = r*30+c */
  hsize_t ad = 3; hid_t at = H5Tarray_create2(H5T_STD_I32LE, 1, &ad);
  hsize_t dims[2] = {2, 30}; hid_t s2 = H5Screate_simple(2, dims, NULL);
  int32_t big[180]; for (int i = 0; i < 180; i++) big[i] = i;
  d = H5Dcreate2(f, "array2d", at, s2, H5P_DEFAULT, H5P_DEFAULT, H5P_DEFAULT);
  H5Dwrite(d, at, H5S_ALL, H5S_ALL, H5P_DEFAULT, big); H5Dclose(d);
  /* the same shape [30] 1-D array dtype, which works */
  hsize_t d1 = 30; hid_t s1 = H5Screate_simple(1, &d1, NULL);
  d = H5Dcreate2(f, "array1d", at, s1, H5P_DEFAULT, H5P_DEFAULT, H5P_DEFAULT);
  H5Dwrite(d, at, H5S_ALL, H5S_ALL, H5P_DEFAULT, big); H5Dclose(d);
  /* external storage: 10 int32 held in a file the browser cannot reach */
  hid_t dcpl = H5Pcreate(H5P_DATASET_CREATE);
  H5Pset_external(dcpl, "elsewhere.bin", 0, H5F_UNLIMITED);
  hsize_t n10 = 10; hid_t s10 = H5Screate_simple(1, &n10, NULL);
  d = H5Dcreate2(f, "external", H5T_STD_I32LE, s10, H5P_DEFAULT, dcpl, H5P_DEFAULT);
  H5Dclose(d); H5Pclose(dcpl);
  /* opaque attribute */
  hid_t root = H5Gopen2(f, "/", H5P_DEFAULT);
  hid_t sc = H5Screate(H5S_SCALAR);
  hid_t ot4 = H5Tcreate(H5T_OPAQUE, 4); H5Tset_tag(ot4, "tag");
  uint8_t ob4[4] = {1, 2, 3, 4};
  hid_t a = H5Acreate2(root, "opaque_attr", ot4, sc, H5P_DEFAULT, H5P_DEFAULT);
  H5Awrite(a, ot4, ob4); H5Aclose(a);
  H5Fclose(f);
  return 0;
}
