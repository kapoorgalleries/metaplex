import asyncio, sys
LH, LP, TH, TP = sys.argv[1], int(sys.argv[2]), sys.argv[3], int(sys.argv[4])
async def pipe(r, w):
    try:
        while (d := await r.read(65536)): w.write(d); await w.drain()
    except Exception: pass
    finally: w.close()
async def handle(cr, cw):
    try: tr, tw = await asyncio.open_connection(TH, TP)
    except Exception: cw.close(); return
    await asyncio.gather(pipe(cr, tw), pipe(tr, cw))
async def main():
    s = await asyncio.start_server(handle, LH, LP)
    async with s: await s.serve_forever()
asyncio.run(main())
