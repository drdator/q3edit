CC = emcc
CXX = em++

CFLAGS = -O2 \
	-D_TTIMOBUILD \
	-I./common \
	-I./q3map \
	-I./include \
	-I./libs \
	-I./libs/jpeg6 \
	-Wno-implicit-function-declaration \
	-Wno-pointer-bool-conversion \
	-Wno-format-security \
	-Wno-return-type \
	-Wno-parentheses \
	-Wno-dangling-else \
	-Wno-incompatible-pointer-types \
	-Wno-int-conversion

CXXFLAGS = $(CFLAGS) -Wno-register -Wno-writable-strings -Wno-c++11-compat-deprecated-writable-strings

EMFLAGS = \
	-sENVIRONMENT='web,worker' \
	-sMODULARIZE=1 \
	-sEXPORT_NAME='createQ3Map' \
	-sEXPORTED_FUNCTIONS='["_main"]' \
	-sEXPORTED_RUNTIME_METHODS='["FS","callMain","cwrap","allocateUTF8","UTF8ToString"]' \
	-sALLOW_MEMORY_GROWTH=1 \
	-sINITIAL_MEMORY=268435456 \
	-sSTACK_SIZE=2097152 \
	-sFORCE_FILESYSTEM=1 \
	-sINVOKE_RUN=0 \
	-sEXIT_RUNTIME=0 \
	-sPURE_WASI=0

Q3MAP_SRCS = \
	q3map/bsp.c \
	q3map/brush.c \
	q3map/brush_primit.c \
	q3map/facebsp.c \
	q3map/fog.c \
	q3map/glfile.c \
	q3map/leakfile.c \
	q3map/light.c \
	q3map/light_trace.c \
	q3map/lightmaps.c \
	q3map/map.c \
	q3map/mesh.c \
	q3map/misc_model.c \
	q3map/nodraw.c \
	q3map/patch.c \
	q3map/portals.c \
	q3map/prtfile.c \
	q3map/shaders.c \
	q3map/surface.c \
	q3map/terrain.c \
	q3map/tjunction.c \
	q3map/tree.c \
	q3map/vis.c \
	q3map/visflow.c \
	q3map/writebsp.c
# Excluded (duplicate symbols with vis.c):
#	q3map/lightv.c   (q3map -vlight)
#	q3map/soundv.c   (q3map -vsound)
#	q3map/lightv.c               (q3map -vlight)
#	q3map/soundv.c               (q3map -vsound)

COMMON_SRCS = \
	common/bspfile.c \
	common/cmdlib.c \
	common/imagelib.c \
	common/mathlib.c \
	common/polylib.c \
	common/scriplib.c \
	common/threads.c \
	common/mutex.c \
	common/aselib.c \
	common/l3dslib.c \
	common/trilib.c \
	common/md4.c

JPEG_SRCS = \
	libs/jpeg6/jcomapi.cpp \
	libs/jpeg6/jdapimin.cpp \
	libs/jpeg6/jdapistd.cpp \
	libs/jpeg6/jdatasrc.cpp \
	libs/jpeg6/jdcoefct.cpp \
	libs/jpeg6/jdcolor.cpp \
	libs/jpeg6/jddctmgr.cpp \
	libs/jpeg6/jdhuff.cpp \
	libs/jpeg6/jdinput.cpp \
	libs/jpeg6/jdmainct.cpp \
	libs/jpeg6/jdmarker.cpp \
	libs/jpeg6/jdmaster.cpp \
	libs/jpeg6/jdpostct.cpp \
	libs/jpeg6/jdsample.cpp \
	libs/jpeg6/jdtrans.cpp \
	libs/jpeg6/jerror.cpp \
	libs/jpeg6/jfdctflt.cpp \
	libs/jpeg6/jidctflt.cpp \
	libs/jpeg6/jmemmgr.cpp \
	libs/jpeg6/jmemnobs.cpp \
	libs/jpeg6/jpgload.cpp \
	libs/jpeg6/jutils.cpp

C_OBJS = $(Q3MAP_SRCS:.c=.o) $(COMMON_SRCS:.c=.o)
CXX_OBJS = $(JPEG_SRCS:.cpp=.o)

OUTPUT = dist/q3map.js

all: $(OUTPUT)

$(OUTPUT): $(C_OBJS) $(CXX_OBJS)
	@mkdir -p $(dir $(OUTPUT))
	$(CC) $(CFLAGS) $(EMFLAGS) $^ -o $@
	@echo "Built $(OUTPUT)"

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

clean:
	rm -f $(C_OBJS) $(CXX_OBJS)
	rm -f $(OUTPUT) $(OUTPUT:.js=.wasm)

.PHONY: all clean
