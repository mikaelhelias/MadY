# ggplot2 reference: geom_raster — continuous fill
df <- expand.grid(x = 0:5, y = 0:5)
set.seed(1)
df$z <- runif(nrow(df))
ggplot(df, aes(x, y, fill = z)) +
  geom_raster()
