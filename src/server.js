const app=require('./app'); const {port}=require('./config/env');
app.listen(port,()=>console.log(`Mr Breado Node backend listening on ${port}`));
