const pool = require('../db/pool');
async function one(sql, params={}) { const [r]=await pool.execute(sql, params); return r[0]||null; }
async function many(sql, params={}) { const [r]=await pool.execute(sql, params); return r; }
async function exec(sql, params={}) { const [r]=await pool.execute(sql, params); return r; }
function slugify(s='item'){return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'item';}
function page(req){const p=Math.max(Number(req.query.page||1),1), limit=Math.min(Math.max(Number(req.query.limit||20),1),100); return {p,limit,offset:(p-1)*limit};}
module.exports={one,many,exec,slugify,page,pool};
