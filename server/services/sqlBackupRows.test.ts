import { test } from "node:test";
import assert from "node:assert/strict";
import { SQL_CHUNK_BYTES, sqlInsertChunks } from "./sqlBackupRows";

test("small rows share bounded multi-row statements without altering quoted SQL", () => {
  const rows = Array.from({length:601},(_,i)=>({values_sql:`${i},'quote''d, newline\n雪',NULL`}));
  const chunks = [...sqlInsertChunks('"s"."t"', '"id","value","missing"', rows)];
  assert.equal(chunks.length,7);
  const expected = rows.map(row=>`(${row.values_sql})`);
  const actual = chunks.flatMap(chunk => chunk.slice(chunk.indexOf("VALUES ") + 7,-2).split("),(")
    .map((value,i,parts) => `${i===0 ? "" : "("}${value}${i===parts.length-1 ? "" : ")"}`));
  assert.deepEqual(actual,expected);
  assert.ok(chunks.every(chunk=>Buffer.byteLength(chunk)<=SQL_CHUNK_BYTES));
});

test("byte budget includes Unicode and repeated statement headers", () => {
  const rows=Array.from({length:300},()=>({values_sql:`'${"雪".repeat(1000)}'`}));
  const chunks=[...sqlInsertChunks('"t"','"value"',rows)];
  assert.ok(chunks.length>3);
  assert.ok(chunks.every(chunk=>Buffer.byteLength(chunk)<=SQL_CHUNK_BYTES));
  assert.equal(chunks.reduce((n,c)=>n+(c.match(/\('雪/g)?.length ?? 0),0),300);
});

test("single oversized rows remain intact, empty tables and zero-column rows are supported", () => {
  const huge={values_sql:`'${"x".repeat(SQL_CHUNK_BYTES*2)}'`};
  const chunks=[...sqlInsertChunks('"t"','"value"',[huge,{values_sql:"NULL"}])];
  assert.equal(chunks.length,2);
  assert.ok(chunks[0].includes(huge.values_sql));
  assert.deepEqual([...sqlInsertChunks('"t"','"value"',[])],[]);
  assert.equal([...sqlInsertChunks('"t"','',[{values_sql:""},{values_sql:""}])].join(""),
    'INSERT INTO "t" DEFAULT VALUES;\nINSERT INTO "t" DEFAULT VALUES;\n');
});
