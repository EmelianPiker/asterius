import { modulify } from "./rts.modulify.mjs";
import { ReentrancyGuard } from "./rts.reentrancy.mjs";
import { EventLogManager } from "./rts.eventlog.mjs";
import { Tracer } from "./rts.tracing.mjs";
import { Memory } from "./rts.memory.mjs";
import { MemoryTrap } from "./rts.memorytrap.mjs";
import { HeapAlloc } from "./rts.heapalloc.mjs";
import { StablePtrManager } from "./rts.stableptr.mjs";
import { StableNameManager } from "./rts.stablename.mjs";
import { StaticPtrManager } from "./rts.staticptr.mjs";
import { Scheduler } from "./rts.scheduler.mjs";
import { IntegerManager } from "./rts.integer.mjs";
import { MemoryFileSystem } from "./rts.fs.mjs";
import { ByteStringCBits } from "./rts.bytestring.mjs";
import { TextCBits } from "./rts.text.mjs";
import { TimeCBits } from "./rts.time.mjs";
import { GC } from "./rts.gc.mjs";
import { ExceptionHelper } from "./rts.exception.mjs";
import { Messages } from "./rts.messages.mjs";
import { FloatCBits } from "./rts.float.mjs";
import { Unicode } from "./rts.unicode.mjs";
import { Exports } from "./rts.exports.mjs";
import { getNodeModules } from "./rts.node.mjs";
import * as rtsConstants from "./rts.constants.mjs";

export async function newAsteriusInstance(req) {
  let __asterius_persistent_state = req.persistentState
      ? req.persistentState
      : {},
    __asterius_reentrancy_guard = new ReentrancyGuard(["Scheduler", "GC"]),
    __asterius_logger = new EventLogManager(req.symbolTable),
    __asterius_tracer = new Tracer(__asterius_logger, req.symbolTable),
    __asterius_wasm_instance = null,
    __asterius_wasm_table = new WebAssembly.Table({
      element: "anyfunc",
      initial: req.tableSlots
    }),
    __asterius_wasm_memory = new WebAssembly.Memory({
      initial: req.staticMBlocks * (rtsConstants.mblock_size / 65536)
    }),
    __asterius_memory = new Memory(),
    __asterius_memory_trap = new MemoryTrap(
      __asterius_logger,
      req.symbolTable,
      __asterius_memory
    ),
    __asterius_heapalloc = new HeapAlloc(
      __asterius_memory
    ),
    __asterius_stableptr_manager = new StablePtrManager(),
    __asterius_stablename_manager = new StableNameManager(
      __asterius_memory,
      __asterius_heapalloc,
      req.symbolTable
    ),
    __asterius_staticptr_manager = new StaticPtrManager(__asterius_memory, __asterius_stableptr_manager, req.sptEntries),
    __asterius_fs = new MemoryFileSystem(req.consoleHistory),
    __asterius_scheduler = new Scheduler(
      __asterius_memory,
      req.symbolTable,
      __asterius_stableptr_manager,
      __asterius_fs
    ),
    __asterius_integer_manager = new IntegerManager(),
    __asterius_bytestring_cbits = new ByteStringCBits(null),
    __asterius_text_cbits = new TextCBits(__asterius_memory),
    __asterius_time_cbits = new TimeCBits(__asterius_memory, req.targetSpecificModule),
    __asterius_gc = new GC(
      __asterius_memory,
      __asterius_heapalloc,
      __asterius_stableptr_manager,
      __asterius_stablename_manager,
      __asterius_scheduler,
      req.infoTables,
      req.symbolTable,
      __asterius_reentrancy_guard,
      req.yolo,
      req.gcThreshold
    ),
    __asterius_float_cbits = new FloatCBits(__asterius_memory),
    __asterius_messages = new Messages(__asterius_memory, __asterius_fs),
    __asterius_unicode = new Unicode(),
    __asterius_exports = new Exports(
      __asterius_memory,
      __asterius_reentrancy_guard,
      req.symbolTable,
      __asterius_scheduler,
      __asterius_stableptr_manager
    ),
    __asterius_exception_helper = new ExceptionHelper(
      __asterius_memory,
      __asterius_heapalloc,
      __asterius_exports,
      req.infoTables,
      req.symbolTable
    );
  __asterius_scheduler.exports = __asterius_exports;

  const __asterius_node_modules = await getNodeModules();

  function __asterius_show_I64(x) {
    return `0x${x.toString(16).padStart(8, "0")}`;
  }

  const __asterius_jsffi_instance = {
    exposeMemory: (p, len, t = Uint8Array) => __asterius_memory.expose(p, len, t),
    newJSVal: v => __asterius_stableptr_manager.newJSVal(v),
    getJSVal: i => __asterius_stableptr_manager.getJSVal(i),
    freeJSVal: i => __asterius_stableptr_manager.freeJSVal(i),
    fs: __asterius_fs,
    stdio: {
      stdout: () => __asterius_fs.readSync(1),
      stderr: () => __asterius_fs.readSync(2)
    },
    returnFFIPromise: (promise) =>
      __asterius_scheduler.returnFFIPromise(promise)
  };


  const importObject = Object.assign(
    req.jsffiFactory(__asterius_jsffi_instance),
    {
      Math: Math,
      WasmTable: {
        table: __asterius_wasm_table
      },
      WasmMemory: {
        memory: __asterius_wasm_memory
      },
      rts: {
        printI64: x =>
          __asterius_fs.writeSync(1, `${__asterius_show_I64(x)}\n`),
        assertEqI64: function(x, y) {
          if (x != y) {
            throw new WebAssembly.RuntimeError(`unequal I64: ${x}, ${y}`);
          }
        },
        print: x => __asterius_fs.writeSync(1, `${x}\n`)
      },
      fs: {
        read: (fd, buf, count) => {
          const p = Memory.unTag(buf);
          return __asterius_node_modules.fs.readSync(
            fd,
            __asterius_memory.i8View,
            p,
            count,
            null
          );
        },
        write: (fd, buf, count) => {
          const p = Memory.unTag(buf);
          return (fd <= 2
            ? __asterius_fs
            : __asterius_node_modules.fs
          ).writeSync(fd, __asterius_memory.i8View.subarray(p, p + count));
        }
      },
      posix: modulify(new (req.targetSpecificModule.posix)(__asterius_memory, rtsConstants)),
      bytestring: modulify(__asterius_bytestring_cbits),
      text: modulify(__asterius_text_cbits),
      time: modulify(__asterius_time_cbits),
      // cannot name this float since float is a keyword.
      floatCBits: modulify(__asterius_float_cbits),
      GC: modulify(__asterius_gc),
      ExceptionHelper: modulify(__asterius_exception_helper),
      HeapAlloc: modulify(__asterius_heapalloc),
      Integer: modulify(__asterius_integer_manager),
      Memory: modulify(__asterius_memory),
      MemoryTrap: modulify(__asterius_memory_trap),
      Messages: modulify(__asterius_messages),
      StablePtr: modulify(__asterius_stableptr_manager),
      StableName: modulify(__asterius_stablename_manager),
      StaticPtr: modulify(__asterius_staticptr_manager),
      Unicode: modulify(__asterius_unicode),
      Tracing: modulify(__asterius_tracer),
      Exports: {
        newHaskellCallback: (sp, arg_tag, ret_tag, io, oneshot) => {
          let sn = [];
          let cb = __asterius_exports.newHaskellCallback(
            sp,
            arg_tag,
            ret_tag,
            io,
            oneshot
              ? () => __asterius_exports.freeHaskellCallback(sn[0])
              : () => {}
          );
          sn[0] = __asterius_stableptr_manager.newJSVal(cb);
          return sn[0];
        },
        freeHaskellCallback: sn => __asterius_exports.freeHaskellCallback(sn)
      },
      Scheduler: modulify(__asterius_scheduler)
    }
  );

  return WebAssembly.instantiate(req.module, importObject).then(i => {
    __asterius_wasm_instance = i;
    __asterius_memory.init(__asterius_wasm_memory, req.staticMBlocks);
    __asterius_heapalloc.init();
    __asterius_bytestring_cbits.memory = __asterius_memory;
    __asterius_scheduler.setGC(__asterius_gc);

    for (const [f, p, a, r, i] of req.exportsStatic) {
      __asterius_exports[
        f
      ] = __asterius_exports.newHaskellCallback(
        __asterius_stableptr_manager.newStablePtr(p),
        a,
        r,
        i,
        () => {}
      );
    }

    Object.assign(__asterius_exports, __asterius_wasm_instance.exports);
    __asterius_exports.hs_init();

    return Object.assign(__asterius_jsffi_instance, {
      exports: __asterius_exports,
      symbolTable: req.symbolTable,
      persistentState: __asterius_persistent_state
    });
  });
}
