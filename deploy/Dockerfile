# 阿里云镜像：Docker 容器方案（方式 D）
# 构建：docker build -t aihao123:latest .
# 运行：docker run -d --name aihao123 -p 8080:80 -v $(pwd)/data:/usr/share/nginx/html/data:ro aihao123:latest
#       （把宿主机 data/ 挂进去，配合 sync-from-github.sh 实现热更新；或用 volume 由容器内同步）
# 然后：nginx 反代 127.0.0.1:8080，或直接用 8080 端口（记得放行）。

FROM nginx:1.27-alpine

COPY site/ /usr/share/nginx/html/
# 数据目录由外部挂载覆盖；这里先拷一份作为初始数据
COPY data/ /usr/share/nginx/html/data/
COPY deploy/nginx-docker.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
