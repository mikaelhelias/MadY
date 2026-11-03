# ggplot2 reference: geom_point — data computed inline (transform / runif)
set.seed(1)
mtcars2 <- transform(mtcars, mpg = ifelse(runif(32) < 0.2, NA, mpg))
ggplot(mtcars2, aes(wt, mpg)) +
  geom_point(na.rm = TRUE)
