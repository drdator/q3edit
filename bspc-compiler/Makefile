CC = emcc

CFLAGS = -O2 \
	-std=gnu89 \
	-Dstricmp=strcasecmp \
	-DCom_Memcpy=memcpy \
	-DCom_Memset=memset \
	-DMAC_STATIC= \
	-DQDECL= \
	-DBSPC \
	-DC_ONLY \
	-fno-common \
	-I./upstream \
	-I./upstream/deps \
	-Wno-deprecated-non-prototype \
	-Wno-format-security \
	-Wno-implicit-function-declaration \
	-Wno-sizeof-pointer-div

EMFLAGS = \
	-sENVIRONMENT='web,worker,node' \
	-sMODULARIZE=1 \
	-sEXPORT_NAME='createBspc' \
	-sEXPORTED_FUNCTIONS='["_main"]' \
	-sEXPORTED_RUNTIME_METHODS='["FS","callMain"]' \
	-sALLOW_MEMORY_GROWTH=1 \
	-sINITIAL_MEMORY=268435456 \
	-sSTACK_SIZE=8388608 \
	-sFORCE_FILESYSTEM=1 \
	-sINVOKE_RUN=0 \
	-sEXIT_RUNTIME=0 \
	-sPURE_WASI=0

BSPC_SRCS = \
	upstream/_files.c \
	upstream/aas_areamerging.c \
	upstream/aas_cfg.c \
	upstream/aas_create.c \
	upstream/aas_edgemelting.c \
	upstream/aas_facemerging.c \
	upstream/aas_file.c \
	upstream/aas_gsubdiv.c \
	upstream/aas_map.c \
	upstream/aas_prunenodes.c \
	upstream/aas_store.c \
	upstream/be_aas_bspc.c \
	upstream/brushbsp.c \
	upstream/bspc.c \
	upstream/csg.c \
	upstream/glfile.c \
	upstream/l_bsp_ent.c \
	upstream/l_bsp_hl.c \
	upstream/l_bsp_q1.c \
	upstream/l_bsp_q2.c \
	upstream/l_bsp_q3.c \
	upstream/l_bsp_sin.c \
	upstream/l_cmd.c \
	upstream/l_log.c \
	upstream/l_math.c \
	upstream/l_mem.c \
	upstream/l_poly.c \
	upstream/l_qfiles.c \
	upstream/l_threads.c \
	upstream/l_utils.c \
	upstream/leakfile.c \
	upstream/map.c \
	upstream/map_hl.c \
	upstream/map_q1.c \
	upstream/map_q2.c \
	upstream/map_q3.c \
	upstream/map_sin.c \
	upstream/nodraw.c \
	upstream/portals.c \
	upstream/textures.c \
	upstream/tree.c

BOTLIB_SRCS = \
	upstream/deps/botlib/be_aas_bspq3.c \
	upstream/deps/botlib/be_aas_cluster.c \
	upstream/deps/botlib/be_aas_move.c \
	upstream/deps/botlib/be_aas_optimize.c \
	upstream/deps/botlib/be_aas_reach.c \
	upstream/deps/botlib/be_aas_sample.c \
	upstream/deps/botlib/l_libvar.c \
	upstream/deps/botlib/l_precomp.c \
	upstream/deps/botlib/l_script.c \
	upstream/deps/botlib/l_struct.c

QCOMMON_SRCS = \
	upstream/deps/qcommon/cm_load.c \
	upstream/deps/qcommon/cm_patch.c \
	upstream/deps/qcommon/cm_test.c \
	upstream/deps/qcommon/cm_trace.c \
	upstream/deps/qcommon/md4.c \
	upstream/deps/qcommon/unzip.c

OBJS = $(BSPC_SRCS:.c=.o) $(BOTLIB_SRCS:.c=.o) $(QCOMMON_SRCS:.c=.o)
OUTPUT = dist/bspc.js

all: $(OUTPUT)

$(OUTPUT): $(OBJS)
	@mkdir -p $(dir $(OUTPUT))
	$(CC) $(CFLAGS) $(EMFLAGS) $^ -o $@
	@echo "Built $(OUTPUT)"

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -f $(OBJS)
	rm -f $(OUTPUT) $(OUTPUT:.js=.wasm)

.PHONY: all clean
