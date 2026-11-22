"""Importa database/loteria_mazahua.sql a la base de Railway (MySQL 8).
Se usa PyMySQL porque el cliente `mysql` de XAMPP no soporta el login de MySQL 8."""
import getpass

import pymysql
from pymysql.constants import CLIENT

host = input("Host (por ejemplo gondola.proxy.rlwy.net): ").strip()
puerto = int(input("Puerto: ").strip())
clave = getpass.getpass("Contraseña (no se ve al escribir): ")

with open("database/loteria_mazahua.sql", encoding="utf-8") as archivo:
    sql = archivo.read()

con = pymysql.connect(host=host, port=puerto, user="root", password=clave, charset="utf8mb4",
                      client_flag=CLIENT.MULTI_STATEMENTS, autocommit=True)
with con.cursor() as cur:
    cur.execute(sql)
    while cur.nextset():
        pass
    cur.execute("SELECT COUNT(*) FROM loteria_mazahuaa.tarjetas")
    print("Listo. Cartas en la base:", cur.fetchone()[0])
con.close()
